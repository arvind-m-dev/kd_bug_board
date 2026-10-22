import { useEffect, useRef } from 'react';

/** Visual-only actors live outside the workspace DOM: no layout, text, or input mutations. */
export function SurfaceEffects({ season }: { season: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const layer = host.current;
    if (!layer) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    let last = 0;
    let elapsed = 0;
    let measured = -Infinity;
    let nextGust = 5000;
    let surfaces: DOMRect[] = [];
    const actors: HTMLElement[] = [];
    const animations = new Set<Animation>();
    const animate = (element: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions) => {
      const animation = element.animate(frames, options);
      animations.add(animation);
      animation.onfinish = () => { animations.delete(animation); element.remove(); };
    };
    if (season === 'halloween') {
      for (let i = 0; i < 3; i++) {
        const bug = document.createElement('div');
        bug.className = 'bf-surface-bug';
        // Separate leg joints and a glossy, shaded shell give the beetle depth without a WebGL context.
        bug.innerHTML = `<svg viewBox="0 0 50 66" width="25" height="33" fill="none"><g stroke="currentColor" stroke-width="2" stroke-linecap="round">${[0, 1, 2].map(j => `<path class="bf-beetle-leg" style="--step:${j % 2 ? '-.16s' : '0s'}" d="M17 ${27 + j * 9} L7 ${22 + j * 10} L2 ${28 + j * 11}"/><path class="bf-beetle-leg" style="--step:${j % 2 ? '0s' : '-.16s'}" d="M33 ${27 + j * 9} L43 ${22 + j * 10} L48 ${28 + j * 11}"/>`).join('')}<path d="M21 16 Q12 5 17 2 M29 16 Q38 5 33 2"/></g><ellipse cx="25" cy="39" rx="13" ry="21" fill="currentColor"/><ellipse cx="25" cy="19" rx="9" ry="9" fill="currentColor"/><ellipse cx="21" cy="34" rx="5" ry="13" fill="#fff" opacity=".16"/><path d="M25 23 V58" stroke="#000" opacity=".5"/><path d="M30 27 Q39 42 30 54" stroke="#fff" opacity=".2"/><circle cx="21" cy="16" r="1.2" fill="#ffd69a"/><circle cx="29" cy="16" r="1.2" fill="#ffd69a"/></svg>`;
        layer.append(bug);
        actors.push(bug);
      }
    }
    const gust = () => {
      // Suppress foreground flourishes while selecting, typing, or using a modal.
      if (document.getSelection()?.toString() || document.querySelector('[role="dialog"], [role="alertdialog"]') || document.activeElement?.matches('input,textarea,[contenteditable="true"]')) return;
      const snowy = season === 'winter' || season === 'christmas';
      const y = 100 + Math.random() * Math.max(100, innerHeight - 240);
      for (let i = 0; i < 12; i++) {
        const particle = document.createElement('i');
        particle.className = `bf-gust-particle ${snowy ? 'bf-gust-snow' : 'bf-gust-leaf'}`;
        particle.style.top = `${y + Math.sin(i * 1.7) * 90}px`;
        particle.style.setProperty('--gust-hue', `${30 + i * 5}`);
        layer.append(particle);
        animate(particle, [
          { transform: `translate3d(-40px,${i * 3}px,0) rotate(0deg) rotateY(0deg)`, opacity: 0 },
          { offset: .2, opacity: snowy ? .55 : .75 },
          { offset: .55, transform: `translate3d(${innerWidth * .55}px,-65px,0) rotate(170deg) rotateY(210deg)`, opacity: .65 },
          { transform: `translate3d(${innerWidth + 50}px,30px,0) rotate(430deg) rotateY(500deg)`, opacity: 0 },
        ], { duration: 4200 + i * 115, delay: i * 80, easing: 'cubic-bezier(.25,.55,.45,1)', fill: 'both' });
      }
      const heading = document.querySelector<HTMLElement>('.bf-page-heading h1, .bf-portal-hero h1');
      if (!heading || !heading.textContent) return;
      const bounds = heading.getBoundingClientRect();
      if (bounds.top < 0 || bounds.bottom > innerHeight) return;
      const font = getComputedStyle(heading);
      // Only echo a public page heading, never bug records, editable text, or table cells.
      const echo = document.createElement('span');
      echo.className = 'bf-wind-echo';
      Object.assign(echo.style, { left: `${bounds.left}px`, top: `${bounds.top}px`, font: font.font, letterSpacing: font.letterSpacing, color: font.color });
      for (const [i, char] of [...heading.textContent.slice(0, 32)].entries()) {
        const letter = document.createElement('span');
        letter.textContent = char === ' ' ? '\u00a0' : char;
        echo.append(letter);
        animate(letter, [
          { transform: 'translate3d(0,0,0) rotate(0)', opacity: 0 },
          { offset: .12, opacity: .45 },
          { transform: `translate3d(${180 + i * 12}px,${-75 - (i % 4) * 22}px,0) rotate(${25 + i * 9}deg)`, opacity: 0 },
        ], { duration: 2200, delay: 500 + i * 55, easing: 'ease-in', fill: 'both' });
      }
      layer.append(echo);
      // Parent cleanup is tied to a finite animation too, avoiding delayed timers on navigation.
      animate(echo, [{ opacity: 1 }, { opacity: 1 }], { duration: 4700 });
    };
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (document.hidden || reduced.matches) { last = now; layer.style.visibility = 'hidden'; return; }
      layer.style.visibility = '';
      if (now - last < 32) return;
      elapsed += Math.min(now - (last || now), 64);
      last = now;
      if (elapsed - measured > 800) {
        surfaces = [...document.querySelectorAll('.bf-table-wrap, .bf-panel, .bf-sidebar')]
          .map(el => el.getBoundingClientRect())
          .filter(r => r.width > 160 && r.height > 80 && r.top < innerHeight - 60 && r.bottom > 100)
          .slice(0, 8);
        measured = elapsed;
      }
      const busy = !!document.querySelector('[role="dialog"], [role="alertdialog"]') || !!document.getSelection()?.toString();
      actors.forEach((actor, i) => {
        const r = surfaces[i % surfaces.length];
        actor.hidden = !r || busy;
        if (!r) return;
        const left = Math.max(14, r.left + 10), right = Math.min(innerWidth - 16, r.right - 10);
        const top = Math.max(85, r.top + 7), bottom = Math.min(innerHeight - 20, r.bottom - 7);
        const w = Math.max(1, right - left), h = Math.max(1, bottom - top);
        const perimeter = 2 * (w + h);
        // Speed eases periodically into a pause, then the beetle continues around the actual surface.
        let d = ((elapsed / 1000 * (22 + i * 5) + Math.sin(elapsed / 1700 + i) * 9 + i * 430) % perimeter);
        let x: number, y: number, angle: number;
        if (d < w) { x = left + d; y = top; angle = 90; }
        else if ((d -= w) < h) { x = right; y = top + d; angle = 180; }
        else if ((d -= h) < w) { x = right - d; y = bottom; angle = 270; }
        else { d -= w; x = left; y = bottom - d; angle = 360; }
        actor.style.transform = `translate3d(${x - 12}px,${y - 16}px,0) rotate(${angle}deg)`;
      });
      if (elapsed > nextGust) { gust(); nextGust = elapsed + 18000 + Math.random() * 14000; }
    };
    const invalidate = () => { measured = -Infinity; };
    window.addEventListener('scroll', invalidate, true);
    window.addEventListener('resize', invalidate);
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', invalidate, true);
      window.removeEventListener('resize', invalidate);
      animations.forEach(a => a.cancel());
      layer.replaceChildren();
    };
  }, [season]);
  return <div ref={host} className="bf-surface-effects" aria-hidden="true" inert />;
}
