export function popConfetti(canvas){
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth;
  const h = window.innerHeight;

  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";
  ctx.scale(dpr, dpr);

  const pieces = [];
  const colors = [
    "rgba(0,255,213,.9)",
    "rgba(255,61,243,.85)",
    "rgba(138,92,255,.85)",
    "rgba(0,163,255,.85)",
    "rgba(255,204,0,.85)"
  ];

  for (let i=0;i<180;i++){
    pieces.push({
      x: w/2 + (Math.random()-0.5)*80,
      y: h/2 + (Math.random()-0.5)*40,
      vx: (Math.random()-0.5)*12,
      vy: -Math.random()*10 - 3,
      g: 0.25 + Math.random()*0.25,
      s: 3 + Math.random()*6,
      r: Math.random()*Math.PI,
      vr: (Math.random()-0.5)*0.3,
      c: colors[i % colors.length],
      life: 240 + Math.random()*60
    });
  }

  let frame = 0;
  function tick(){
    frame++;
    ctx.clearRect(0,0,w,h);
    for (const p of pieces){
      p.vy += p.g;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      p.life--;

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.s/2, -p.s/2, p.s, p.s*0.65);
      ctx.restore();
    }

    if (pieces.some(p => p.life > 0 && p.y < h+50)){
      requestAnimationFrame(tick);
    }else{
      ctx.clearRect(0,0,w,h);
    }
  }
  tick();
}
