/**
 * Test-only stand-in for `next/image`. next/image's real implementation
 * needs Next's own build/runtime context (image optimizer, loader config)
 * that isn't present when a component is loaded directly by `node --test`.
 * This renders a plain <img> with the same props, which is what the
 * component actually renders in the DOM once Next.js finishes wrapping it,
 * so props like src/alt/width/height are still exercised the same way.
 */
export default function Image({ src, alt, width, height, unoptimized, ...rest }) {
  // eslint-disable-next-line @next/next/no-img-element -- this file IS the next/image stand-in for tests
  return <img src={src} alt={alt} width={width} height={height} {...rest} />;
}
