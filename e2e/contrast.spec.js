import { test, expect } from '@playwright/test';

test('audit homepage color contrast', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(3000); // Allow Next dev compilation and styles to load

  const violations = await page.evaluate(() => {
    // Canvas trick to normalize any CSS color string to rgba
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d');

    function colorToRgba(colorStr) {
      if (!ctx) return 'rgba(0, 0, 0, 0)';
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = colorStr;
      ctx.fillRect(0, 0, 1, 1);
      const data = ctx.getImageData(0, 0, 1, 1).data;
      return `rgba(${data[0]}, ${data[1]}, ${data[2]}, ${data[3] / 255})`;
    }

    function getRelativeLuminance(colorStr) {
      const normalized = colorToRgba(colorStr);
      const match = normalized.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (!match) return 0;
      const r = parseInt(match[1]) / 255;
      const g = parseInt(match[2]) / 255;
      const b = parseInt(match[3]) / 255;

      const adjust = (val) => {
        return val <= 0.03928 ? val / 12.92 : Math.pow((val + 0.055) / 1.055, 2.4);
      };

      return 0.2126 * adjust(r) + 0.7152 * adjust(g) + 0.0722 * adjust(b);
    }

    function getContrastRatio(lum1, lum2) {
      const l1 = Math.max(lum1, lum2);
      const l2 = Math.min(lum1, lum2);
      return (l1 + 0.05) / (l2 + 0.05);
    }

    function parseRgba(rgbaStr) {
      const match = rgbaStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (!match) return { r: 255, g: 255, b: 255, a: 1 };
      return {
        r: parseInt(match[1]),
        g: parseInt(match[2]),
        b: parseInt(match[3]),
        a: match[4] !== undefined ? parseFloat(match[4]) : 1
      };
    }

    // Handles solid color ancestors, including parent gradient containers by checking if we have standard solid colors
    function getEffectiveBackgroundColor(element) {
      let current = element;
      const stack = [];

      while (current) {
        const style = window.getComputedStyle(current);
        const bg = style.backgroundColor;
        
        // Check if there is an background-image linear-gradient (a gradient background)
        const bgImg = style.backgroundImage;
        if (bgImg && bgImg.includes('gradient')) {
          // If we hit a gradient background, let's treat it as its base color or fallback
          if (current.className.includes('bg-gradient-to-br')) {
            stack.push({ r: 15, g: 118, b: 110, a: 1 }); // Approximation of emerald-700 / teal-700
            break;
          }
        }

        const rgbaStr = colorToRgba(bg);
        const color = parseRgba(rgbaStr);
        if (color.a > 0.01 && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
          stack.push(color);
          if (color.a >= 0.99) {
            break; // Opaque base
          }
        }
        current = current.parentElement;
      }

      if (stack.length === 0 || stack[stack.length - 1].a < 0.99) {
        stack.push({ r: 255, g: 255, b: 255, a: 1 });
      }

      // Blend from top (opaque base) down to bottom (the element's background)
      let blended = stack.pop();
      while (stack.length > 0) {
        const fg = stack.pop();
        blended = {
          r: Math.round(fg.r * fg.a + blended.r * (1 - fg.a)),
          g: Math.round(fg.g * fg.a + blended.g * (1 - fg.a)),
          b: Math.round(fg.b * fg.a + blended.b * (1 - fg.a)),
          a: 1
        };
      }
      return `rgb(${blended.r}, ${blended.g}, ${blended.b})`;
    }

    const results = [];
    const elements = document.querySelectorAll('*');

    for (const el of elements) {
      // Skip script, style tags
      if (['script', 'style', 'link', 'noscript', 'iframe'].includes(el.tagName.toLowerCase())) {
        continue;
      }

      // Check if it's a leaf node with visible text
      const text = el.innerText ? el.innerText.trim() : '';
      if (!text) continue;

      // Ensure it has children elements, but is the leaf text node
      if (el.children.length > 0 && Array.from(el.childNodes).every(node => node.nodeType !== Node.TEXT_NODE || !node.textContent.trim())) {
        continue;
      }

      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue; // Hidden

      const style = window.getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none' || parseFloat(style.opacity) === 0) continue;

      const color = style.color;
      const bgColor = getEffectiveBackgroundColor(el);

      const lum1 = getRelativeLuminance(color);
      const lum2 = getRelativeLuminance(bgColor);
      const ratio = getContrastRatio(lum1, lum2);

      const fontSizePx = parseFloat(style.fontSize);
      const fontWeight = style.fontWeight;
      const isLargeText = fontSizePx >= 24 || (fontSizePx >= 18.66 && parseInt(fontWeight) >= 700);
      const minRatio = isLargeText ? 3.0 : 4.5;

      if (ratio < minRatio) {
        let path = el.tagName.toLowerCase();
        if (el.id) path += '#' + el.id;
        if (el.className) path += '.' + el.className.split(' ').filter(Boolean).slice(0, 2).join('.');
        
        results.push({
          path,
          text: text.slice(0, 60),
          color,
          bgColor,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          ratio: ratio.toFixed(2),
          required: minRatio
        });
      }
    }
    return results;
  });

  console.log('--- Contrast Audit Results ---');
  console.log(`Found ${violations.length} contrast violations:`);
  console.log(JSON.stringify(violations, null, 2));
  console.log('------------------------------');

  expect(violations.length).toBeLessThan(100);
});


