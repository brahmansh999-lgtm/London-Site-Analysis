export function tightenSvgViewBox(svgText: string): string {
  const pathMatches = svgText.matchAll(/d="([^"]+)"/g);
  const xs: number[] = [], ys: number[] = [];

  for (const match of pathMatches) {
    const nums = match[1].match(/[-+]?\d*\.?\d+/g) ?? [];
    for (let i = 0; i < nums.length - 1; i += 2) {
      xs.push(parseFloat(nums[i]));
      ys.push(parseFloat(nums[i + 1]));
    }
  }

  if (xs.length === 0) return svgText;

  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  const pad  = Math.max(maxX - minX, maxY - minY) * 0.04;

  const vb = `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`;

  return svgText
    .replace(/\swidth="[^"]*"/, '')
    .replace(/\sheight="[^"]*"/, '')
    .replace(/viewBox="[^"]*"/, `viewBox="${vb}"`)
    .replace(/<svg /, '<svg width="100%" height="100%" preserveAspectRatio="xMidYMid meet" ');
}

export function recolourSvg(svgText: string): string {
  return svgText
    .replace(/stroke="#000000"/g, 'stroke="#FFFFFF" stroke-width="2"')
    .replace(/stroke="#BF3FFF"/g, 'stroke="#00FFFA" stroke-width="1"')
    .replace(/stroke="#007F00"/g, 'stroke="#AAB8C2" stroke-width="0.8"')
    .replace(/stroke="#BF3F3F"/g, 'stroke="#F4A261" stroke-width="1"')
    .replace(/stroke="#FF0000"/g, 'stroke="rgba(255,255,255,0.2)" stroke-width="0.5"')
    .replace(/stroke="#00FFFA"/g, 'stroke="#90E0EF" stroke-width="1"');
}
