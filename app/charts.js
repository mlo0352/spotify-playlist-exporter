import { clamp } from "./utils.js";

export function drawBarChart(canvas, labels, values){
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || canvas.width;
  const h = canvas.clientHeight || canvas.height;

  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  ctx.scale(dpr, dpr);

  ctx.clearRect(0,0,w,h);
  ctx.fillStyle = "rgba(255,255,255,.0)";
  ctx.fillRect(0,0,w,h);

  const pad = 18;
  const top = 12;
  const bottom = 24;
  const left = 12;
  const right = 12;

  const plotW = w - left - right;
  const plotH = h - top - bottom;

  const max = Math.max(1, ...values);
  const n = values.length;
  const gap = 6;
  const barW = (plotW - gap*(n-1)) / n;

  // axes
  ctx.strokeStyle = "rgba(0,0,0,.08)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(left, top + plotH);
  ctx.lineTo(left + plotW, top + plotH);
  ctx.stroke();

  for (let i=0;i<n;i++){
    const v = values[i];
    const bh = (v / max) * plotH;
    const x = left + i*(barW+gap);
    const y = top + (plotH - bh);

    // neon-ish gradient
    const g = ctx.createLinearGradient(x, y, x, y + bh);
    g.addColorStop(0, "rgba(0,255,213,.85)");
    g.addColorStop(.55, "rgba(255,61,243,.65)");
    g.addColorStop(1, "rgba(138,92,255,.75)");

    ctx.fillStyle = g;
    roundRect(ctx, x, y, barW, bh, 10);
    ctx.fill();

    // label
    ctx.fillStyle = "rgba(16,18,23,.75)";
    ctx.font = "11px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    const label = (labels[i] || "").slice(0, 12);
    ctx.save();
    ctx.translate(x + barW/2, top + plotH + 16);
    ctx.rotate(-0.26);
    ctx.textAlign = "center";
    ctx.fillText(label, 0, 0);
    ctx.restore();
  }
}

export function drawTimeline(canvas, points){
  // points: [{date, count}] sorted by date
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || canvas.width;
  const h = canvas.clientHeight || canvas.height;

  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  ctx.scale(dpr, dpr);

  ctx.clearRect(0,0,w,h);

  const pad = 14;
  const top = 12;
  const bottom = 24;
  const left = 12;
  const right = 12;

  const plotW = w - left - right;
  const plotH = h - top - bottom;

  const max = Math.max(1, ...(points.map(p => p.count)));
  const n = points.length || 1;

  // axis
  ctx.strokeStyle = "rgba(0,0,0,.08)";
  ctx.beginPath();
  ctx.moveTo(left, top + plotH);
  ctx.lineTo(left + plotW, top + plotH);
  ctx.stroke();

  // line
  ctx.lineWidth = 2.5;
  const grad = ctx.createLinearGradient(left, top, left + plotW, top);
  grad.addColorStop(0, "rgba(0,163,255,.85)");
  grad.addColorStop(.5, "rgba(255,61,243,.65)");
  grad.addColorStop(1, "rgba(0,255,213,.85)");
  ctx.strokeStyle = grad;

  ctx.beginPath();
  for (let i=0;i<points.length;i++){
    const p = points[i];
    const x = left + (i/(points.length-1 || 1)) * plotW;
    const y = top + (plotH - (p.count/max)*plotH);
    if (i === 0) ctx.moveTo(x,y);
    else ctx.lineTo(x,y);
  }
  ctx.stroke();

  // dots
  for (let i=0;i<points.length;i+= Math.ceil(points.length/22)){
    const p = points[i];
    const x = left + (i/(points.length-1 || 1)) * plotW;
    const y = top + (plotH - (p.count/max)*plotH);
    ctx.fillStyle = "rgba(255,255,255,.95)";
    ctx.strokeStyle = "rgba(0,0,0,.10)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x,y,4.5,0,Math.PI*2);
    ctx.fill();
    ctx.stroke();
  }
}

function roundRect(ctx, x, y, w, h, r){
  r = clamp(r, 0, Math.min(w,h)/2);
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.arcTo(x+w, y, x+w, y+h, r);
  ctx.arcTo(x+w, y+h, x, y+h, r);
  ctx.arcTo(x, y+h, x, y, r);
  ctx.arcTo(x, y, x+w, y, r);
  ctx.closePath();
}
