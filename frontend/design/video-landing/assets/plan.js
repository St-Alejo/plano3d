/**
 * La casa del video, en metros (6,60 × 12,60, norte arriba): la misma forma que la lámina de la
 * foto. Lo usan la escena del plano y la del cierre, así el dibujo es el mismo en las dos.
 */
window.PLAN = {
  W: 6.6,
  H: 12.6,
  walls: [
    [0, 0, 6.6, 0],
    [0, 0, 0, 3.4], [0, 5.4, 0, 12.6],
    [6.6, 0, 6.6, 3.0], [6.6, 5.0, 6.6, 11.2], [6.6, 12.2, 6.6, 12.6],
    [0, 12.6, 0.3, 12.6], [3.3, 12.6, 3.9, 12.6], [4.8, 12.6, 6.6, 12.6],
    [0, 2.2, 2.0, 2.2], [4.6, 2.2, 6.6, 2.2],
    [0, 6.8, 4.2, 6.8], [5.8, 6.8, 6.6, 6.8],
    [3.6, 6.8, 3.6, 7.8], [3.6, 8.6, 3.6, 12.6],
    [3.6, 9.4, 4.0, 9.4], [4.8, 9.4, 6.6, 9.4],
    [3.6, 10.8, 4.4, 10.8], [5.2, 10.8, 6.6, 10.8],
  ],
  // puerta: bisagra a, otro extremo b, hacia dónde abre (vector unitario)
  doors: [
    { a: [3.9, 12.6], b: [4.8, 12.6], n: [0, -1] },
    { a: [3.6, 7.8], b: [3.6, 8.6], n: [1, 0] },
    { a: [4.0, 9.4], b: [4.8, 9.4], n: [0, 1] },
    { a: [4.4, 10.8], b: [5.2, 10.8], n: [0, 1] },
  ],
  windows: [
    [0, 3.4, 0, 5.4],
    [6.6, 3.0, 6.6, 5.0],
    [6.6, 11.2, 6.6, 12.2],
    [2.0, 2.2, 4.6, 2.2],
  ],
  gate: [0.3, 12.6, 3.3, 12.6],
  stairs: { x0: 4.2, x1: 5.8, y0: 7.0, y1: 9.0, step: 0.25 },
  rooms: [
    ['Terraza', 3.3, 1.2],
    ['Sala-comedor', 3.3, 4.6],
    ['Garaje', 1.8, 9.8],
    ['Baño', 5.1, 10.15],
    ['Estudio', 5.1, 11.75],
  ],
  // cotas escritas: texto, posición y giro
  dims: [
    { id: 'd-ancho', text: '6,60', x: 3.3, y: -0.55, rot: 0, line: [0, -0.35, 6.6, -0.35] },
    { id: 'd-largo', text: '12,60', x: -0.6, y: 6.3, rot: -90, line: [-0.35, 0, -0.35, 12.6] },
    { id: 'd-sala', text: '4,60', x: 7.2, y: 4.5, rot: 90, line: [6.95, 2.2, 6.95, 6.8] },
    { id: 'd-garaje', text: '3,60', x: 1.8, y: 13.25, rot: 0, line: [0, 13.0, 3.6, 13.0] },
  ],
}

/** Dibuja el plano en un <svg> con viewBox en metros. `parts` elige qué capas se crean. */
window.drawPlan = function drawPlan(svg, parts) {
  const P = window.PLAN
  const NS = 'http://www.w3.org/2000/svg'
  const el = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag)
    for (const k in attrs) e.setAttribute(k, attrs[k])
    ;(parent || svg).appendChild(e)
    return e
  }
  const g = (id) => el('g', { id })
  const line = (s, attrs, parent) => el('line', { x1: s[0], y1: s[1], x2: s[2], y2: s[3], ...attrs }, parent)
  const pre = svg.dataset.prefix || ''

  if (parts.includes('pencil')) {
    const p = g(pre + 'pencil')
    P.walls.forEach((s) => line(s, { class: 'pencil' }, p))
    P.windows.forEach((s) => line(s, { class: 'pencil' }, p))
    P.doors.forEach((d) => line([d.a[0], d.a[1], d.a[0] + d.n[0] * 0.8, d.a[1] + d.n[1] * 0.8], { class: 'pencil' }, p))
    const st = P.stairs
    for (let y = st.y0; y <= st.y1 + 1e-6; y += st.step) line([st.x0, y, st.x1, y], { class: 'pencil' }, p)
  }
  if (parts.includes('walls')) {
    const w = g(pre + 'walls')
    P.walls.forEach((s, i) => line(s, { class: 'wall', id: pre + 'w' + i }, w))
  }
  if (parts.includes('stairs')) {
    const st = P.stairs
    const s = g(pre + 'stairs')
    for (let y = st.y0; y <= st.y1 + 1e-6; y += st.step) line([st.x0, y, st.x1, y], { class: 'tread' }, s)
    el('rect', { x: st.x0, y: st.y0, width: st.x1 - st.x0, height: st.y1 - st.y0, class: 'tread-box' }, s)
  }
  if (parts.includes('doors')) {
    const d = g(pre + 'doors')
    P.doors.forEach((o) => {
      const w = Math.hypot(o.b[0] - o.a[0], o.b[1] - o.a[1])
      const tip = [o.a[0] + o.n[0] * w, o.a[1] + o.n[1] * w]
      const one = el('g', { class: 'door' }, d)
      line([o.a[0], o.a[1], tip[0], tip[1]], { class: 'leaf' }, one)
      // arco de la hoja: de la punta al otro extremo del vano
      const cross = (tip[0] - o.a[0]) * (o.b[1] - o.a[1]) - (tip[1] - o.a[1]) * (o.b[0] - o.a[0])
      el('path', { d: `M${tip[0]} ${tip[1]} A${w} ${w} 0 0 ${cross > 0 ? 1 : 0} ${o.b[0]} ${o.b[1]}`, class: 'swing' }, one)
    })
    line(P.gate, { class: 'gate' }, d)
  }
  if (parts.includes('windows')) {
    const wg = g(pre + 'windows')
    P.windows.forEach((s) => {
      const one = el('g', { class: 'window' }, wg)
      const vx = s[2] - s[0]
      const off = vx === 0 ? [0.06, 0] : [0, 0.06]
      line([s[0] - off[0], s[1] - off[1], s[2] - off[0], s[3] - off[1]], { class: 'glass' }, one)
      line([s[0] + off[0], s[1] + off[1], s[2] + off[0], s[3] + off[1]], { class: 'glass' }, one)
    })
  }
  if (parts.includes('rooms')) {
    const r = g(pre + 'rooms')
    P.rooms.forEach(([t, x, y]) => {
      const e = el('text', { x, y, class: 'room' }, r)
      e.textContent = t
    })
  }
  if (parts.includes('dims')) {
    const dg = g(pre + 'dims')
    P.dims.forEach((d) => {
      const one = el('g', { id: pre + d.id, class: 'dim' }, dg)
      line(d.line, { class: 'dim-line' }, one)
      const t = el('text', { x: d.x, y: d.y, class: 'dim-text', transform: `rotate(${d.rot} ${d.x} ${d.y})` }, one)
      t.textContent = d.text
    })
  }
}
