export const meta = {
  name: "Crossfade",
  description: "Blends smoothly from one look to the next.",
  params: {},
};
export function render(ctx) {
  const { a, b, out, progress } = ctx;
  const p = ease.inOut(progress);
  for (let i = 0; i < out.length; i++) out[i] = a[i] + (b[i] - a[i]) * p;
}
