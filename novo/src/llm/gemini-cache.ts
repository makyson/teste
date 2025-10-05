import { GoogleGenAI, createUserContent } from "@google/genai";
import { env } from "../env";
import { pool } from "../vector/db";
import { sha256 } from "../utils/hash";
import { secondsFromNowIso } from "../utils/time";

const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

type EnsureCacheOpts = {
  policyId: string;
  model: string;
  body: string;
  ttlSeconds?: number;
};

export async function ensurePolicyCacheFromString(opts: EnsureCacheOpts) {
  const ttl = opts.ttlSeconds ?? 7200; // 2h
  const versionId = sha256(`${opts.model}:${opts.body}`);
  const client = await pool.connect();
  try {
    const q = await client.query(
      `SELECT gemini_cache_name, expires_at FROM policy_caches WHERE id=$1`,
      [versionId]
    );
    if (q.rowCount) {
      const { gemini_cache_name, expires_at } = q.rows[0];
      const exp = new Date(expires_at).getTime();
      if (Date.now() > exp - 10 * 60 * 1000) {
        try {
          await ai.caches.update({
            name: gemini_cache_name,
            config: { ttl: `${ttl}s` },
          });
          await client.query(
            `UPDATE policy_caches SET expires_at=$2 WHERE id=$1`,
            [versionId, secondsFromNowIso(ttl)]
          );
        } catch {
          await client.query(`DELETE FROM policy_caches WHERE id=$1`, [
            versionId,
          ]);
        }
      }
      return { cacheName: gemini_cache_name, versionId };
    }

    const created = await ai.caches.create({
      model: opts.model,
      config: {
        contents: createUserContent({ text: opts.body }),
        ttl: `${ttl}s`,
      },
    });

    await client.query(
      `INSERT INTO policy_caches (id, policy_id, gemini_cache_name, model, ttl_seconds, expires_at)
VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        versionId,
        opts.policyId,
        created.name,
        opts.model,
        ttl,
        secondsFromNowIso(ttl),
      ]
    );

    return { cacheName: created.name, versionId };
  } finally {
    client.release();
  }
}
