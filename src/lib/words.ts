export interface Word {
  id: string;
  text: string;
  start: number;
  end: number;
}

/** Lowercase, strip accents and punctuation: "Été," → "ete". */
export function norm(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9']+/g, "")
    .replace(/^'+|'+$/g, "");
}

/** True when the word closes a sentence or clause in the transcript. */
export function endsClause(text: string): boolean {
  return /[.!?…;:]["»”]?$/.test(text.trim());
}

export function endsSentence(text: string): boolean {
  return /[.!?…]["»”]?$/.test(text.trim());
}

/** French hesitations removed by the cut step (normalized form). */
export const FILLERS = new Set([
  "euh", "euhh", "euhhh", "heu", "heuu", "eh", "hum", "humm", "hmm", "mmh", "mh", "bah", "beh", "ben", "pff", "ah", "oh",
]);

/** Phrases that announce a retake: the take they sit in is dropped. Normalized, space separated. */
export const RESTART_MARKERS = [
  "je recommence", "on recommence", "je reprends", "on reprend", "je la refais", "on la refait", "je refais",
  "on refait", "attends je", "non attends", "attends attends", "pardon je", "coupe", "on coupe", "recommencons",
  "reprenons", "je redis", "je me suis trompe",
];

/** Common French function words: never picked as a "strong" word. */
export const STOPWORDS = new Set(
  (
    "a ai aie aient aies ait alors as au aucun aussi autre aux avais avait avant avec avez avoir avons bon c ca car ce " +
    "ceci cela celle celles celui cependant certain ces cet cette ceux chaque chez ci comme comment d dans de des deja " +
    "depuis devrait doit donc dont du elle elles en encore entre es est et etaient etais etait etant ete etre eu eux " +
    "fait faire fais faut fois font hors ici il ils j je juste l la le les leur leurs lui m ma mais me meme mes moi mon " +
    "n ne ni non nos notre nous on ont ou par parce pas peu peut peux plus pour pourquoi puis qu quand que quel quelle " +
    "quelles quels qui quoi s sa sans se sera ses si sien sinon soit son sont sous sur t ta te tes toi ton tous tout " +
    "toute toutes tres tu un une unes uns va vais vas vers voici voila vont vos votre vous vu y c'est j'ai qu'il qu'on " +
    "d'un d'une l'on n'est s'il c'etait j'etais il y a voila genre truc chose choses vraiment enfin bref quoi donc " +
    "the a an and or of to in is it that this you i we"
  ).split(/\s+/),
);

/** A spoken quantity worth animating: digits ("30", "1 000", "50%") or a large French number word. */
export function numericValue(text: string): number | null {
  const t = text.replace(/[\s  ]/g, "").replace(",", ".");
  const m = /^(\d+(?:\.\d+)?)(%|€|\$|k)?[.,!?]?$/i.exec(t);
  if (m) return Number(m[1]) * (m[2]?.toLowerCase() === "k" ? 1000 : 1);
  const n = norm(text);
  if (["cent", "cents"].includes(n)) return 100;
  if (n === "mille") return 1000;
  if (["million", "millions"].includes(n)) return 1_000_000;
  if (["milliard", "milliards"].includes(n)) return 1_000_000_000;
  // Small spoken numbers ("trois", "dix") are too frequent to animate.
  return null;
}
