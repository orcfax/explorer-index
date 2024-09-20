import { FactStatement } from './types.js';

export function isSameFacts(factsX: FactStatement[], factsY: FactStatement[]) {
  if (factsX.length !== factsY.length) return false;

  const xIDs = factsX.map((fact) => fact.fact_urn);
  const yIDs = factsY.map((fact) => fact.fact_urn);

  return xIDs.every((id) => yIDs.includes(id));
}
