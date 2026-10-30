export const meta = {
  name: "Dip to black",
  description: "Fades out, then fades the new look in.",
  params: {},
};
export function render(ctx) {
  const { a, b, out, progress } = ctx;
  const src = progress < 0.5 ? a : b;
  const k = ease.inOut(Math.abs(progress - 0.5) * 2);
  for (let i = 0; i < out.length; i++) out[i] = src[i] * k;
}
