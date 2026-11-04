// Structured, human-readable explanation for one architecture block, shown
// in the /pipeline side panels next to the real captured activations.
// `formula` is an array so a multi-step computation (e.g. attentive
// pooling) renders as separate, labeled lines instead of one dense string.
export interface BlockExplainer {
  formula: string[];
  input: string;
  output: string;
  process: string;
  calculation: string;
  why: string;
}
