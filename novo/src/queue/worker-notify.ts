import { Worker } from "bullmq";
import { redis } from "../cache/redis";

export function startNotifyWorker(concurrency = 8) {
  new Worker(
    "notify",
    async (job) => {
      const { scheduleId } = job.data as { scheduleId: string };
      // TODO: aqui você chama seu fluxo (ex.: gerar relatório e notificar)
      console.log("[notify] disparo de", scheduleId, "job", job.id);
    },
    {
      connection: redis ? (redis.options as any) : undefined,
      concurrency,
    }
  );
}
