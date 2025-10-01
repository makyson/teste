// src/nlq/cypherFixes.js
export function patchNaiveDateSubtractions(cypher) {
  if (!cypher) return cypher;

  let out = cypher;

  // 1) Troca "date() - N" -> "date() - duration({days: N})"
  out = out.replace(
    /date\s*\(\)\s*-\s*(\d+)\b/gi,
    (_m, d) => `date() - duration({days: ${d}})`
  );

  // 2) Casos comuns de igualdade
  out = out.replace(
    /date\(\s*m\.day\s*\)\s*=\s*date\(\)\s*-\s*(\d+)\b/gi,
    (_m, d) => `date(m.day) = date() - duration({days: ${d}})`
  );

  // 3) Em listas IN, ex.: [date() - 1, date()]
  out = out.replace(/(\[([^\]]*)\])/g, (full, list, inside) => {
    const patched = inside.replace(
      /date\s*\(\)\s*-\s*(\d+)\b/gi,
      (_m, d) => `date() - duration({days: ${d}})`
    );
    return `[${patched}]`;
  });

  return out;
}
