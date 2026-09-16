// Os 10 filmes da Gnars, um por tweet da campanha "Gnars.com features"
// (gnars.sopa.team/campaign-creator/cmu2vin8p0000l804sdd63aej). Cada cena
// recria a página em primitivas, com os assets reais do gnars.com (Gnars da
// leilão, fotos dos rails, riders, logos, a escultura 3D do NogglesRail), e
// anima UMA interação como função pura do tempo. Todo número é exemplo.

import type { FeatureFilm, FilmSet } from "./types";
import { at, caretOn, clickAt, countUp, cursorAt, out, smooth, spring, stage, typed } from "./take";
import { loadRail3D } from "./three-rail";

const A = "public:/projects/gnars/films" as const;
const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Confete determinístico: quadradinhos da cor da marca saindo de um ponto. */
function burst(p: Parameters<FeatureFilm["draw"]>[0], t: number, from: number, x: number, y: number, n = 16) {
  const life = (t - from) / 1.1;
  if (life <= 0 || life >= 1) return;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.3, speed = 90 + (i * 37) % 60;
    const px = x + Math.cos(a) * speed * out(life), py = y + Math.sin(a) * speed * out(life) + life * life * 90;
    p.ctx.save();
    p.ctx.globalAlpha *= 1 - life;
    p.ctx.translate(px, py);
    p.ctx.rotate(life * 6 + i);
    p.rect(-4, -4, 8, 8, i % 3 === 0 ? "#f5f4f2" : p.c.accent, 1);
    p.ctx.restore();
  }
}

const auctions: FeatureFilm = {
  id: "auctions",
  label: "Auctions",
  url: "gnars.com/auctions",
  tweetDoc: "Tweet 1",
  seconds: 12,
  headline: ["One Gnar a day.", "One vote per bid."],
  subtitle: "Daily auctions on Base",
  steps: ["Open the live auction", "Place a bid", "Hold a vote in the DAO"],
  tweet:
    "One Gnar goes up for auction every day on Base. The winning bid gives you a vote in the DAO, and the ETH goes to the treasury that pays for trips, rails and video parts. The live one is here. https://gnars.com/auctions",
  exampleValues: true,
  assets: { gnar: `${A}/gnar-1.webp`, next: `${A}/gnar-2.webp`, noggles: `${A}/noggles.png`, r1: `${A}/riders/yan.png`, r2: `${A}/riders/r4to.png`, r3: `${A}/riders/zima.png` },
  captions: ["Open the live auction", "Place a bid", "Bid placed", "Hold a vote in the DAO"],
  captionAt: (t) => stage(t, [[2.7, 0], [5.6, 1], [8.5, 2]] as const, 3),
  draw(p, t) {
    const s = stage(t, [[2.7, "browse"], [5.6, "bid"], [6.1, "pressing"]] as const, "placed");
    const cursor = cursorAt(t, [{ at: 0.6, x: 210, y: 210 }, { at: 2.4, x: 70, y: 70 }, { at: 3.1, x: 70, y: 70 }, { at: 5.2, x: 0, y: 204 }, { at: 6.4, x: 0, y: 204 }, { at: 7.4, x: 230, y: 250 }], [2.7, 5.6], 0.5, 7.4);
    p.card(-250, -240, 500, 480);
    p.image("noggles", -224, -220, 40, 20);
    p.text("Gnar 6005", -172, -200, 22, p.c.text, 700);
    p.pill(146, -224, "LIVE", { active: true });
    // O Gnar inteiro (é quadrado), num tile à esquerda, com a luz da marca.
    p.glow(-127, -81, 170, p.c.accent + "22");
    p.ctx.save();
    p.ctx.beginPath();
    p.ctx.roundRect(-222, -176, 190, 190, 14);
    p.ctx.clip();
    p.rect(-222, -176, 190, 190, p.c.surface2, 0);
    const wobble = 1 + Math.sin(t * 0.8) * 0.01;
    p.ctx.translate(-127, -81);
    p.ctx.scale(wobble, wobble);
    if (!p.image("gnar", -95, -95, 190, 190)) p.noggles(-64, -30, 130);
    p.ctx.restore();
    p.rect(-222, -176, 190, 190, "#00000000", 14, p.c.accent + "40");
    // Coluna da direita: lance, tempo, quem está dando lance.
    p.text("CURRENT BID", -12, -160, 11, p.c.muted, 650);
    p.text(s === "placed" ? "0.45 ETH" : "0.42 ETH", -12, -128, 28, s === "placed" ? p.c.accent : p.c.text, 800);
    p.text("ENDS IN", -12, -90, 11, p.c.muted, 650);
    p.text(mmss(Math.max(0, 299 - Math.floor(t))), -12, -58, 28, p.c.text, 800);
    ["r1", "r2", "r3"].forEach((id, i) => {
      const x = 2 + i * 22;
      p.circle(x, -22, 13, p.c.surface2);
      p.ctx.save();
      p.ctx.beginPath();
      p.ctx.arc(x, -22, 12, 0, Math.PI * 2);
      p.ctx.clip();
      p.imageCover(id, x - 12, -34, 24, 24, 0, { anchor: "top", zoom: 2.2 });
      p.ctx.restore();
    });
    p.text(`${countUp(t, 0.8, 12, 1.4) + (s === "placed" ? 1 : 0)} bids`, 78, -17, 12, p.c.muted, 600);
    if (s === "placed") {
      p.fade(6.1, 0.4, () => {
        p.rect(-222, 40, 444, 62, p.c.accent + "18", 14, p.c.accent + "60");
        p.check(-196, 71, 9);
        p.text("Bid placed · 0.45 ETH", -176, 77, 18, p.c.text, 700);
      });
      p.fade(7, 0.5, () => {
        p.text("Win it and you hold one vote in the DAO.", -222, 136, 14, p.c.muted, 500);
        p.ctx.save();
        p.ctx.beginPath();
        p.ctx.roundRect(158, 112, 64, 64, 10);
        p.ctx.clip();
        p.rect(158, 112, 64, 64, p.c.surface2, 0);
        p.image("next", 158, 112, 64, 64);
        p.ctx.restore();
        p.text("NEXT", 158, 192, 10, p.c.muted, 650);
      });
      burst(p, t, 6.15, 0, 70);
    } else {
      const value = typed("0.45", t, 3.1, 4.1);
      p.input(-222, 40, 444, 56, value ? `Ξ ${value}` : "", "Ξ 0.45 or more", { focused: s === "bid", caret: s === "bid" && t < 4.4 && caretOn(t), size: 20 });
      p.button(-222, 176, 444, 52, s === "browse" ? "Enter a bid" : "Place bid", { enabled: s !== "browse", pressed: s === "pressing" ? clickAt(t, [5.6]) : 1 });
    }
    p.cursor(cursor);
  },
};

const proposals: FeatureFilm = {
  id: "proposals",
  label: "Proposals",
  url: "gnars.com/proposals",
  tweetDoc: "Tweet 2",
  seconds: 11,
  headline: ["Every trip started", "as a proposal."],
  subtitle: "Onchain funding on Base, written by skaters",
  steps: ["Read how they pitched", "Open one and see the vote", "Write yours"],
  tweet:
    "Every trip, rail and video part Gnars has funded started as a proposal on gnars.com, written by the skaters who wanted it. Read how they pitched theirs, then write yours. https://gnars.com/proposals",
  exampleValues: true,
  assets: { p1: `${A}/rails/minas-gerais.jpg`, p2: `${A}/rails/argentina.jpg`, p3: `${A}/rails/kenya.jpg`, author: `${A}/riders/pamtech.png` },
  captions: ["Read how they pitched", "Open one and see the vote", "Vote, then write yours"],
  captionAt: (t) => stage(t, [[3.2, 0], [7.5, 1]] as const, 2),
  draw(p, t) {
    const opened = at(t, 3.4, 0.5);
    const cursor = cursorAt(t, [{ at: 0.6, x: 230, y: 230 }, { at: 2.9, x: -60, y: -150 }, { at: 3.6, x: -60, y: -150 }, { at: 7.1, x: -120, y: 196 }, { at: 8, x: -120, y: 196 }, { at: 9, x: 240, y: 250 }], [3.2, 7.5], 0.5, 9);
    const rows: [string, string, string, string][] = [
      ["NogglesRail in Medellín", "ACTIVE", "1.2 ETH", "p1"],
      ["Video part: Gnargentina", "EXECUTED", "0.8 ETH", "p2"],
      ["Skate trip to Nairobi", "QUEUED", "2.0 ETH", "p3"],
    ];
    p.ctx.save();
    p.ctx.globalAlpha *= 1 - opened;
    p.text("Proposals", -250, -222, 22, p.c.text, 700);
    p.pill(160, -244, "129 ON BASE", {});
    rows.forEach(([title, status, ask, photo], i) => {
      p.reveal(i, 0.8, 0.25, () => {
        const y = -190 + i * 84;
        p.row(-250, y, 500, 70, { active: i === 0 && t > 2.9 });
        if (!p.imageCover(photo, -238, y + 9, 68, 52, 8)) p.rect(-238, y + 9, 68, 52, p.c.surface2, 8);
        p.text(title, -156, y + 30, 17, p.c.text, 700);
        p.pill(-156, y + 40, status, { active: status === "ACTIVE", size: 10, height: 22 });
        p.text(ask, 228, y + 42, 16, p.c.muted, 600, "right");
      });
    });
    p.reveal(3, 0.8, 0.25, () => p.button(-250, 90, 500, 50, "Write a proposal", { ghost: true }));
    p.ctx.restore();
    if (opened > 0) {
      p.ctx.save();
      p.ctx.globalAlpha *= opened;
      p.ctx.translate(0, (1 - opened) * 30);
      p.card(-250, -240, 500, 480);
      if (!p.imageCover("p1", -250, -240, 500, 150, 26, { zoom: 1.05 + (t - 3.4) * 0.01, dy: -12 })) p.rect(-250, -240, 500, 150, p.c.surface2, 26);
      const shade = p.ctx.createLinearGradient(0, -240, 0, -90);
      shade.addColorStop(0, "#00000000");
      shade.addColorStop(1, p.c.surface + "f5");
      p.rect(-250, -240, 500, 150, shade, 26);
      p.pill(-222, -128, "PROP 131 · ACTIVE", { active: true });
      p.text("NogglesRail in Medellín", -222, -70, 24, p.c.text, 800);
      p.ctx.save();
      p.ctx.beginPath();
      p.ctx.arc(-208, -42, 11, 0, Math.PI * 2);
      p.ctx.clip();
      p.imageCover("author", -219, -53, 22, 22, 0, { anchor: "top" });
      p.ctx.restore();
      p.text("Requesting 1.2 ETH · by pharra.eth", -190, -37, 14, p.c.muted, 500);
      p.wrap("A CC0 rail for the Parque del Río spot, built from the open-source PDF. Local crew installs it; the DAO covers steel and transport.", -222, -6, 14, 444, p.c.muted, 500, 20, 2);
      const forShare = 0.78 * out((t - 4) / 1.8);
      p.text("FOR", -222, 58, 11, p.c.muted, 650);
      p.text(`${Math.round(forShare * 100)}%`, 222, 58, 11, p.c.accent, 700, "right");
      p.progress(-222, 68, 444, forShare, { height: 10 });
      p.text(`${countUp(t, 4, 834, 1.8)} votes · ends in 2 days`, -222, 106, 13, p.c.muted, 500);
      if (t >= 8) {
        p.fade(8, 0.4, () => {
          p.rect(-222, 176, 444, 52, p.c.accent + "18", 26, p.c.accent + "60");
          p.check(-40, 202, 8);
          p.text("Voted for", -20, 208, 16, p.c.text, 700);
        });
        burst(p, t, 8.05, -120, 200, 12);
      } else {
        p.button(-222, 176, 214, 52, "For", { pressed: clickAt(t, [7.5]) });
        p.button(8, 176, 214, 52, "Against", { ghost: true });
      }
      p.ctx.restore();
    }
    p.cursor(cursor);
  },
};

const bounties: FeatureFilm = {
  id: "bounties",
  label: "Bounties",
  url: "gnars.com/community/bounties",
  tweetDoc: "Tweet 3",
  seconds: 11,
  headline: ["Film the trick.", "Get paid onchain."],
  subtitle: "ETH escrowed on POIDH, no grant form",
  steps: ["Pick a bounty", "Film it and upload the proof", "First legit claim gets paid"],
  tweet:
    "Gnars Bounties work like this: someone posts the trick they want to see and puts ETH in escrow on POIDH. You film it, upload the proof, and the first legit claim gets paid onchain. No grant form, no waiting. https://gnars.com/community/bounties",
  exampleValues: true,
  assets: { photo: `${A}/rails/chicago.jpg`, poidh: `${A}/poidh.png`, eth: "public:/tokens/eth.svg" },
  captions: ["Pick a bounty", "Upload the proof", "Paid onchain"],
  captionAt: (t) => stage(t, [[4.8, 0], [7.8, 1]] as const, 2),
  draw(p, t) {
    const s = stage(t, [[4.8, "open"], [5.3, "claiming"], [7.8, "uploading"]] as const, "paid");
    const cursor = cursorAt(t, [{ at: 0.6, x: 220, y: 220 }, { at: 4.4, x: 0, y: 204 }, { at: 5.2, x: 0, y: 204 }, { at: 6.2, x: 230, y: 250 }], [4.8], 0.5, 6.2);
    p.card(-250, -240, 500, 480);
    if (!p.imageCover("photo", -250, -240, 500, 130, 26, { zoom: 1.08 + t * 0.006, dy: -20 })) p.rect(-250, -240, 500, 130, p.c.surface2, 26);
    const shade = p.ctx.createLinearGradient(0, -240, 0, -110);
    shade.addColorStop(0, "#00000010");
    shade.addColorStop(1, p.c.surface + "f5");
    p.rect(-250, -240, 500, 130, shade, 26);
    p.pill(-222, -222, "OPEN · SKATE", { active: true });
    p.text("Impossible late flip", -222, -142, 26, p.c.text, 800);
    p.wrap("Say “this is for poidh”, land it, no cuts. Slow-mo replay welcome.", -222, -114, 13, 444, p.c.muted, 500, 18, 2);
    p.text("REWARD", -222, -62, 11, p.c.muted, 650);
    p.image("eth", -224, -46, 26, 26);
    p.text("0.023 ETH", -192, -26, 28, p.c.accent, 800);
    p.text("ESCROW · POIDH", 222, -62, 11, p.c.muted, 650, "right");
    p.rect(170, -52, 52, 52, "#0b0b0d", 12, p.c.border);
    p.image("poidh", 176, -46, 40, 40);
    const milestones: [string, number][] = [["Film it", 1.4], ["Upload proof", 6.6], ["Get paid", 8.6]];
    milestones.forEach(([label, doneAt], i) => {
      const x = -160 + i * 160;
      const done = t >= doneAt;
      if (i < 2) p.line(x + 18, 20, x + 142, 20, t >= milestones[i + 1][1] ? p.c.accent + "80" : p.c.border, 2);
      p.rect(x - 16, 4, 32, 32, done ? p.c.accent + "30" : p.c.surface2, 16, done ? p.c.accent + "60" : p.c.border);
      if (done) p.check(x, 20, 6);
      else if ((i === 1 && s === "uploading") || (i === 2 && s === "uploading" && t > 7.4)) p.spinner(x, 20, 7);
      p.text(label, x, 64, 12, done ? p.c.accent : p.c.muted, 600, "center");
    });
    if (s === "uploading") {
      p.text("clip-late-flip.mp4", -222, 118, 14, p.c.text, 600);
      p.text(`${Math.round(smooth((t - 5.3) / 2.2) * 100)}%`, 222, 118, 14, p.c.muted, 600, "right");
      p.progress(-222, 130, 444, smooth((t - 5.3) / 2.2));
    }
    if (s === "paid") {
      p.fade(7.8, 0.4, () => {
        p.rect(-222, 100, 444, 60, p.c.accent + "18", 14, p.c.accent + "60");
        p.check(-196, 130, 9);
        p.text("Verified · 0.023 ETH paid onchain", -176, 136, 17, p.c.text, 700);
      });
      burst(p, t, 7.85, 0, 130, 14);
    }
    if (s === "open" || s === "claiming") p.button(-222, 176, 444, 52, "Claim bounty", { pressed: s === "claiming" ? clickAt(t, [4.8]) : 1 });
    else p.text("First legit claim wins. No form, no waiting.", 0, 208, 14, p.c.muted, 500, "center");
    p.cursor(cursor);
  },
};

const droposals: FeatureFilm = {
  id: "droposals",
  label: "Droposals",
  url: "gnars.com/droposals",
  tweetDoc: "Tweet 4",
  seconds: 10,
  headline: ["The parts we fund", "don't disappear."],
  subtitle: "Funded videos, minted as Droposals",
  steps: ["Scrub the archive", "Open a part", "Minted as an NFT"],
  tweet:
    "The video parts and tour edits the DAO funds don't disappear into a feed. They get minted as Droposals and live on gnars.com, Gnargentina included. Scrub through the archive. https://gnars.com/droposals",
  assets: { t1: `${A}/rails/argentina.jpg`, t2: `${A}/rails/chicago.jpg`, t3: `${A}/rails/kenya.jpg`, t4: `${A}/rails/minas-gerais.jpg`, t5: `${A}/rails/sopadeletras.jpg`, t6: `${A}/nograil-icon.png` },
  captions: ["Scrub the archive", "Open a part", "Minted as an NFT"],
  captionAt: (t) => stage(t, [[3.5, 0], [6.5, 1]] as const, 2),
  draw(p, t) {
    const opened = at(t, 3.7, 0.5);
    const cursor = cursorAt(t, [{ at: 0.6, x: 230, y: 230 }, { at: 3.1, x: -170, y: -140 }, { at: 3.8, x: -170, y: -140 }, { at: 5, x: 240, y: 250 }], [3.5], 0.5, 5);
    const tiles: [string, string][] = [["Gnargentina", "t1"], ["Chicago", "t2"], ["Skate Across Africa", "t3"], ["Minas Gerais", "t4"], ["Sopa de Letras", "t5"], ["NogglesRail", "t6"]];
    p.ctx.save();
    p.ctx.globalAlpha *= 1 - opened;
    p.text("Droposals", -250, -222, 22, p.c.text, 700);
    p.pill(178, -244, "ARCHIVE", {});
    tiles.forEach(([title, id], i) => {
      p.reveal(i, 0.7, 0.18, () => {
        const x = -250 + (i % 3) * 170, y = -190 + Math.floor(i / 3) * 150;
        const lift = i === 0 ? at(t, 2.9, 0.4) * 6 : 0;
        p.ctx.save();
        p.ctx.translate(0, -lift);
        if (lift > 0) p.glow(x + 80, y + 50, 120, p.c.accent + "30");
        if (!p.imageCover(id, x, y, 160, 100, 12, { zoom: 1.05 })) p.rect(x, y, 160, 100, p.c.surface2, 12);
        p.rect(x, y, 160, 100, "#00000030", 12, i === 0 && t > 3.1 ? p.c.accent + "80" : "#ffffff10");
        p.circle(x + 80, y + 50, 17, "#000000a0");
        p.ctx.beginPath();
        p.ctx.moveTo(x + 75, y + 41);
        p.ctx.lineTo(x + 75, y + 59);
        p.ctx.lineTo(x + 89, y + 50);
        p.ctx.closePath();
        p.ctx.fillStyle = p.c.text;
        p.ctx.fill();
        p.text(title, x, y + 124, 13, p.c.text, 600);
        p.ctx.restore();
      });
    });
    p.ctx.restore();
    if (opened > 0) {
      p.ctx.save();
      p.ctx.globalAlpha *= opened;
      p.ctx.scale(0.9 + opened * 0.1, 0.9 + opened * 0.1);
      p.card(-250, -240, 500, 480);
      if (!p.imageCover("t1", -222, -212, 444, 250, 14, { zoom: 1 + (t - 3.7) * 0.012, dx: -(t - 3.7) * 3 })) p.rect(-222, -212, 444, 250, p.c.surface2, 14);
      const shade = p.ctx.createLinearGradient(0, -100, 0, 38);
      shade.addColorStop(0, "#00000000");
      shade.addColorStop(1, "#000000a0");
      p.rect(-222, -212, 444, 250, shade, 14);
      p.circle(0, -87, 30, "#000000a0");
      p.ring(0, -87, 30 + ((t * 0.8) % 1) * 18, 0, Math.PI * 2, p.c.accent + "60", 1.5);
      p.ctx.beginPath();
      p.ctx.moveTo(-8, -102);
      p.ctx.lineTo(-8, -72);
      p.ctx.lineTo(16, -87);
      p.ctx.closePath();
      p.ctx.fillStyle = p.c.text;
      p.ctx.fill();
      p.text("Gnargentina", -222, 78, 24, p.c.text, 800);
      p.text("Droposal #110 · Devconnect tour, Buenos Aires", -222, 104, 13, p.c.muted, 500);
      p.pill(-222, 128, "MINTED AS NFT", { active: true });
      p.pill(-92, 128, "0.005 ETH MINT", {});
      p.button(-222, 176, 444, 52, "Watch the part", {});
      p.ctx.restore();
    }
    p.cursor(cursor);
  },
};

const swap: FeatureFilm = {
  id: "swap",
  label: "Swap",
  url: "gnars.com/swap",
  tweetDoc: "Tweet 5",
  seconds: 12,
  headline: ["Same swap.", "One extra reason."],
  subtitle: "Any token on Base, 0.5% to the treasury if you tick it",
  steps: ["Enter the amount", "Tick “Support Gnars treasury”", "Review the swap"],
  tweet:
    "You can trade any token on Base straight from gnars.com, best route across 150+ DEXes. Tick \"Support Gnars treasury\" and 0.5% of the trade goes to the pot that builds skate spots. Same swap, one extra reason. https://gnars.com/swap",
  exampleValues: true,
  assets: { eth: "public:/tokens/eth.svg", mor: `${A}/morpheus.webp`, base: "public:/tokens/base.png" },
  captions: ["Choose what you pay", "Enter the amount", "Tick “Support Gnars treasury”", "Review the swap", "Scripted walkthrough · example amounts"],
  captionAt: (t) => stage(t, [[2.2, 0], [5, 1], [7.6, 2], [9.4, 3]] as const, 4),
  draw(p, t) {
    const s = stage(t, [[2.2, "idle"], [5, "typing"], [7.6, "ticking"], [8.1, "pressing"]] as const, "review");
    const cursor = cursorAt(t, [{ at: 0.6, x: 220, y: 220 }, { at: 1.9, x: 150, y: -130 }, { at: 2.5, x: 150, y: -130 }, { at: 4.6, x: -205, y: 92 }, { at: 5.4, x: -205, y: 92 }, { at: 7.3, x: 0, y: 204 }, { at: 8.3, x: 0, y: 204 }, { at: 9.2, x: 240, y: 250 }], [2.2, 5, 7.6], 0.5, 9.2);
    const amount = typed("0.1", t, 2.5, 3.3);
    const ticked = t >= 5;
    p.card(-250, -240, 500, 480);
    if (s === "review") {
      p.fade(8.1, 0.4, () => {
        p.text("Review swap", -222, -190, 24, p.c.text, 700);
        p.streak(-90, -110, 90, -110, 8.1);
        p.coin("eth", -140, -110, 46, "0.1 ETH", "#627eea");
        p.coin("mor", 140, -110, 46, "128.4 MOR", "#2fbf71");
        p.rect(-222, 0, 444, 120, p.c.surface2, 16, p.c.border);
        [["Route", "Best of 150+ DEXes"], ["Support Gnars treasury", "0.5% · on"], ["Example amounts", "scripted walkthrough"]].forEach(([k, v], i) => {
          p.text(k, -204, 30 + i * 36, 13, p.c.muted, 500);
          p.text(v, 204, 30 + i * 36, 13, i === 1 ? p.c.accent : p.c.text, 600, "right");
        });
        p.image("base", 180, 128, 22, 22);
        p.text("on Base", 172, 144, 12, p.c.muted, 500, "right");
        p.button(-222, 176, 444, 52, "Confirm swap", {});
      });
    } else {
      p.text("Swap", -222, -190, 24, p.c.text, 700);
      p.image("base", 222 - p.measure("Base · 150+ DEXes", 12, 600) - 26, -207, 20, 20);
      p.text("Base · 150+ DEXes", 222, -192, 12, p.c.muted, 600, "right");
      p.text("YOU PAY", -222, -152, 11, p.c.muted, 650);
      p.row(-222, -140, 190, 56, { active: t > 1.9 });
      if (!p.image("eth", -208, -126, 28, 28)) p.circle(-194, -112, 14, "#627eea");
      p.text("ETH", -172, -105, 18, p.c.text, 700);
      p.text(amount || "0", 222, -100, 32, amount ? p.c.text : p.c.dim, 700, "right");
      if (s === "typing" && t < 3.6 && caretOn(t)) p.line(226, -128, 226, -98, p.c.accent, 2);
      p.line(-222, -66, 222, -66);
      p.rect(-21, -87, 42, 42, p.c.surface2, 21, p.c.border);
      p.text("↓", 0, -59, 20, p.c.accent, 500, "center");
      p.text("YOU RECEIVE", -222, -34, 11, p.c.muted, 650);
      p.row(-222, -22, 190, 56, {});
      if (!p.image("mor", -208, -8, 28, 28)) p.circle(-194, 6, 14, "#1f8f5f");
      p.text("MOR", -172, 13, 18, p.c.text, 700);
      p.text(amount ? "128.4" : "—", 222, 18, 32, amount ? p.c.accent : p.c.dim, 700, "right");
      p.rect(-222, 60, 444, 46, ticked ? p.c.accent + "18" : p.c.surface2, 12, ticked ? p.c.accent + "60" : p.c.border);
      p.rect(-208, 73, 20, 20, ticked ? p.c.accent : "#0c0c0e", 5, ticked ? p.c.accent : p.c.border);
      if (ticked) p.check(-198, 83, 5, p.c.onAccent);
      p.text("Support Gnars treasury (0.5%)", -178, 89, 14, p.c.text, 600);
      p.text("skate spots, rails, trips", 206, 89, 11, p.c.muted, 500, "right");
      if (ticked) burst(p, t, 5.02, -198, 83, 10);
      p.button(-222, 176, 444, 52, "Review swap", { enabled: !!amount, pressed: s === "pressing" ? clickAt(t, [7.6]) : 1 });
    }
    p.cursor(cursor);
  },
};

// Os 16 rails do gnars.com/nogglesrails, com as coordenadas do site.
const RAILS: [string, number, number][] = [
  ["Rio", -22.9, -43.17], ["Long Beach", 33.81, -118.21], ["Santo Domingo", 18.49, -69.93], ["Chicago", 41.97, -87.66], ["Porto Alegre", -30.02, -51.18],
  ["Nairobi", -1.29, 36.82], ["São Paulo", -23.5, -46.62], ["Manhuaçu", -20.25, -42.03], ["Rusutsu", 42.74, 140.91], ["Medellín", 6.24, -75.6],
  ["London", 51.52, -0.21], ["Buenos Aires", -34.58, -58.39], ["Milan", 45.48, 9.19], ["Orange County", 33.72, -117.85], ["Itapetininga", -23.59, -48.05],
];
const LABELED = new Set(["Rio", "Long Beach", "Nairobi", "Rusutsu", "London", "Medellín", "Buenos Aires", "Milan", "Chicago"]);
const D2R = Math.PI / 180;
const globePoint = (lat: number, lon: number, rot: number, R: number) => {
  const phi = lat * D2R, lam = (lon + rot) * D2R;
  return { x: R * Math.cos(phi) * Math.sin(lam), y: -R * Math.sin(phi), z: Math.cos(phi) * Math.cos(lam) };
};

const nogglesrails: FeatureFilm = {
  id: "nogglesrails",
  label: "NogglesRails",
  url: "gnars.com/nogglesrails",
  tweetDoc: "Tweet 6",
  seconds: 13,
  headline: ["A rail in your city", "is a proposal."],
  subtitle: "Community-funded, CC0, open-source build PDF",
  steps: ["Rails around the world", "All CC0, one open PDF", "No rail near you? Propose one"],
  tweet:
    "NogglesRails: community-funded skate rails from Praça XV in Rio to Nairobi to Rusutsu, all CC0, with an open-source build PDF anyone can copy. No rail in your city? That's a proposal. https://gnars.com/nogglesrails",
  assets: { icon: `${A}/nograil-icon.png`, k1: `${A}/rails/kenya.jpg`, k2: `${A}/rails/argentina.jpg`, k3: `${A}/rails/sopadeletras.jpg` },
  // A escultura fica no vermelho "OG Nogglesrail" do site, seja qual for o accent.
  prepare: async () => ({ rail3d: await loadRail3D("/projects/gnars/films/nograil.glb", { frameColor: "#FF2D2D" }) }),
  captions: ["Rails around the world", "All CC0, one open PDF", "No rail near you? Propose one"],
  captionAt: (t) => stage(t, [[4.5, 0], [8.4, 1]] as const, 2),
  draw(p, t) {
    // Globo com as coordenadas reais, girando; grade só na face visível.
    const R = 232, rot = -35 + t * 9;
    const gIn = at(t, 0.2, 1);
    p.ctx.save();
    p.ctx.globalAlpha *= gIn;
    p.glow(0, -20, 260, p.c.accent + "14");
    p.ring(0, -20, R, 0, Math.PI * 2, p.c.accent + "45", 1.5);
    const grid = (pts: { x: number; y: number; z: number }[]) => {
      p.ctx.beginPath();
      let pen = false;
      for (const q of pts) {
        if (q.z <= 0.02) { pen = false; continue; }
        if (!pen) p.ctx.moveTo(q.x, q.y - 20);
        else p.ctx.lineTo(q.x, q.y - 20);
        pen = true;
      }
      p.ctx.strokeStyle = p.c.accent + "1c";
      p.ctx.lineWidth = 1;
      p.ctx.stroke();
    };
    for (let lon = -180; lon < 180; lon += 30) grid(Array.from({ length: 37 }, (_, i) => globePoint(-90 + i * 5, lon, rot, R)));
    for (let lat = -60; lat <= 60; lat += 30) grid(Array.from({ length: 73 }, (_, i) => globePoint(lat, -180 + i * 5, rot, R)));
    RAILS.forEach(([city, lat, lon], i) => {
      const q = globePoint(lat, lon, rot, R);
      const drop = out((t - 2.2 - i * 0.22) / 0.5);
      if (q.z <= 0.05 || drop <= 0) return;
      const y = q.y - 20 - (1 - drop) * 40;
      p.ctx.save();
      p.ctx.globalAlpha *= drop * Math.min(1, q.z * 2);
      p.glow(q.x, y, 18, p.c.accent + "70");
      p.circle(q.x, y, 4.5, p.c.accent);
      p.ring(q.x, y, 5 + ((t * 1.3 + i * 0.3) % 1) * 12, 0, Math.PI * 2, p.c.accent + "50", 1.2);
      if (LABELED.has(city) && q.z > 0.35) p.text(city, q.x, y - 11, 11, p.c.text, 650, "center");
      p.ctx.restore();
    });
    p.ctx.restore();
    // A escultura 3D do site, no centro, girando com o tempo.
    const sIn = spring((t - 1.1) / 1.3);
    if (sIn > 0) {
      p.ctx.save();
      p.ctx.translate(0, -70);
      p.ctx.scale(sIn, sIn);
      p.glow(0, 0, 260, p.c.accent + "2a");
      if (!p.scene3d("rail3d", -340, -215, 680, 430, { spin: 0.5, zoom: 0.82 })) p.image("icon", -130, -130, 260, 260);
      p.ctx.restore();
    }
    // Três polaroids dos rails de verdade, entrando no fim.
    p.reveal(0, 7.6, 0.25, () => p.polaroid("k1", -258, 92, 130, 88, -0.09, "Nairobi"));
    p.reveal(1, 7.6, 0.25, () => p.polaroid("k2", -70, 102, 130, 88, 0.05, "Buenos Aires"));
    p.reveal(2, 7.6, 0.25, () => p.polaroid("k3", 118, 90, 130, 88, -0.04, "São Paulo"));
    const statsIn = at(t, 5.6, 0.6);
    if (statsIn > 0) {
      p.ctx.save();
      p.ctx.globalAlpha *= statsIn;
      p.stat(-250, 268, String(countUp(t, 5.6, 16)), "rails", { size: 30 });
      p.stat(-60, 268, String(countUp(t, 5.8, 9)), "countries", { size: 30 });
      p.stat(130, 268, String(countUp(t, 6, 4)), "continents", { size: 30 });
      p.ctx.restore();
    }
    p.fade(9.4, 0.5, () => p.pill(-96, 300, "CC0 · OPEN-SOURCE BUILD PDF", { active: true }));
  },
};

const RIDERS: [string, string][] = [["Vlad", "vlad"], ["Yan", "yan"], ["r4to", "r4to"], ["Pam", "pamtech"]];

const stake: FeatureFilm = {
  id: "stake",
  label: "Stake",
  url: "gnars.com/stake",
  tweetDoc: "Tweet 7",
  seconds: 11,
  headline: ["Stake or die.", "Back a rider."],
  subtitle: "Your deposit stays yours; the yield is shared",
  steps: ["Pick a rider", "Deposit", "Half the yield backs the rider and the treasury"],
  tweet:
    "Stake or Die. Pick a Gnars rider and back them with a deposit that stays yours and keeps earning. You keep half the yield, the other half backs your rider and the treasury. https://gnars.com/stake",
  exampleValues: true,
  assets: Object.fromEntries(RIDERS.map(([, id]) => [id, `${A}/riders/${id}.png`])),
  captions: ["Pick a rider", "Deposit", "The yield is split in two", "Your deposit stays yours"],
  captionAt: (t) => stage(t, [[2.8, 0], [5.5, 1], [8.2, 2]] as const, 3),
  draw(p, t) {
    const s = stage(t, [[2.8, "pick"], [5.5, "amount"], [8.2, "split"], [8.7, "pressing"]] as const, "staked");
    const cursor = cursorAt(t, [{ at: 0.6, x: 220, y: 220 }, { at: 2.5, x: -168, y: -150 }, { at: 3.2, x: -168, y: -150 }, { at: 4.4, x: 120, y: -30 }, { at: 5.2, x: 120, y: -30 }, { at: 7.9, x: 0, y: 204 }, { at: 9, x: 0, y: 204 }, { at: 9.8, x: 240, y: 250 }], [2.8, 4.7, 8.2], 0.5, 9.8);
    p.card(-250, -240, 500, 480);
    p.text("Stake or Die", -222, -190, 24, p.c.text, 700);
    p.text("PICK YOUR RIDER", -222, -152, 11, p.c.muted, 650);
    RIDERS.forEach(([name, id], i) => {
      p.reveal(i, 0.6, 0.15, () => {
        const x = -222 + i * 112;
        const picked = i === 0 && t >= 2.8;
        const lift = picked ? at(t, 2.8, 0.4) * 6 : 0;
        p.ctx.save();
        p.ctx.translate(0, -lift);
        if (picked) p.glow(x + 50, -96, 90, p.c.accent + "30");
        p.rect(x, -140, 100, 92, picked ? p.c.accent + "18" : p.c.surface2, 14, picked ? p.c.accent + "70" : p.c.border);
        if (!p.imageCover(id, x + 6, -134, 88, 62, 10, { anchor: "top", zoom: 2.3, dy: -6 })) p.avatar(x + 50, -104, 20, name.slice(0, 1).toUpperCase(), (i * 90 + 340) % 360);
        p.text(name, x + 50, -58, 13, picked ? p.c.accent : p.c.text, 650, "center");
        p.ctx.restore();
      });
    });
    const amount = typed("100", t, 4.9, 5.5);
    p.text("YOUR DEPOSIT", -222, -24, 11, p.c.muted, 650);
    p.input(-222, -12, 444, 52, amount ? `${amount} USDC` : "", "0 USDC", { focused: s === "amount", caret: s === "amount" && caretOn(t), size: 20, align: "right" });
    const split = out((t - 5.6) / 1.4);
    p.text("WHERE THE YIELD GOES", -222, 70, 11, p.c.muted, 650);
    p.rect(-222, 80, 444, 14, p.c.surface2, 7);
    if (split > 0) {
      p.rect(-222, 80, 222 * split, 14, p.c.accent, 7);
      p.rect(0, 80, 222 * split, 14, p.c.text + "80", 7);
      p.ctx.save();
      p.ctx.globalAlpha *= split;
      p.text("You · 50%", -222, 118, 13, p.c.accent, 650);
      p.text("Rider + treasury · 50%", 222, 118, 13, p.c.text, 650, "right");
      p.ctx.restore();
    }
    if (s === "staked") {
      p.fade(8.7, 0.4, () => {
        p.rect(-222, 176, 444, 52, p.c.accent + "18", 26, p.c.accent + "60");
        p.check(-98, 202, 8);
        p.text("Staked with Vlad · your deposit stays yours", -78, 208, 15, p.c.text, 700);
      });
      burst(p, t, 8.75, 0, 200, 12);
    } else p.button(-222, 176, 444, 52, "Stake", { enabled: !!amount, pressed: s === "pressing" ? clickAt(t, [8.2]) : 1 });
    p.cursor(cursor);
  },
};

const FEED_EVENTS: [string, string, string, string][] = [
  ["bid", "0.31 ETH bid on Gnar 6005", "now", "noggles"],
  ["vote", "Vote FOR on Prop 131", "1m", "will"],
  ["prop", "Prop 132 created: Itapetininga ramp", "3m", "zima"],
  ["bounty", "Bounty claimed: impossible late flip", "6m", "poidh"],
  ["bid", "0.28 ETH bid on Gnar 6005", "9m", "noggles"],
];

const feed: FeatureFilm = {
  id: "feed",
  label: "Live feed",
  url: "gnars.com/feed",
  tweetDoc: "Tweet 8",
  seconds: 9,
  headline: ["What a DAO does", "all day."],
  subtitle: "Every bid, vote and proposal, as it happens",
  steps: ["Bids come in", "Votes land", "Refreshes every minute"],
  tweet:
    "Want to see what a DAO actually does all day? The live feed on gnars.com shows every bid, vote and proposal on Base as it happens, refreshed every minute. https://gnars.com/feed",
  exampleValues: true,
  assets: { noggles: `${A}/noggles.png`, will: `${A}/riders/will.png`, zima: `${A}/riders/zima.png`, poidh: `${A}/poidh.png` },
  draw(p, t) {
    p.card(-250, -240, 500, 480);
    p.circle(-214, -196, 5, p.c.accent);
    p.ring(-214, -196, 5 + ((t * 1.2) % 1) * 12, 0, Math.PI * 2, p.c.accent + "60", 1.5);
    p.text("Live feed", -198, -190, 22, p.c.text, 700);
    p.text("refreshes every 60 s", 222, -192, 12, p.c.muted, 600, "right");
    const shown = Math.min(FEED_EVENTS.length, Math.floor((t - 0.5) / 1.1) + 1);
    for (let i = 0; i < shown; i++) {
      const idx = shown - 1 - i;
      const enter = smooth((t - 0.5 - i * 1.1) / 0.45);
      const y = -150 + idx * 72 + (1 - enter) * -30;
      const [kind, label, when, icon] = FEED_EVENTS[shown - 1 - idx];
      p.ctx.save();
      p.ctx.globalAlpha *= enter;
      p.row(-222, y, 444, 60, { active: idx === 0 });
      const color = kind === "bid" ? p.c.accent : kind === "vote" ? "#5ec8ff" : kind === "prop" ? "#ffd166" : "#9be15d";
      p.circle(-192, y + 30, 16, p.c.surface2);
      if (icon === "noggles") p.image("noggles", -206, y + 22, 28, 16);
      else if (icon === "poidh") p.image("poidh", -207, y + 24, 30, 12);
      else {
        p.ctx.save();
        p.ctx.beginPath();
        p.ctx.arc(-192, y + 30, 15, 0, Math.PI * 2);
        p.ctx.clip();
        p.imageCover(icon, -207, y + 15, 30, 30, 0, { anchor: "top" });
        p.ctx.restore();
      }
      p.circle(-178, y + 42, 4, color);
      p.text(label, -164, y + 35, 15, p.c.text, 600);
      p.text(idx === 0 ? "now" : when, 206, y + 35, 12, p.c.muted, 500, "right");
      p.ctx.restore();
    }
  },
};

const propdates: FeatureFilm = {
  id: "propdates",
  label: "Propdates",
  url: "gnars.com/propdates",
  tweetDoc: "Tweet 9",
  seconds: 10,
  headline: ["Funded", "is not finished."],
  subtitle: "Progress reports from every funded proposal",
  steps: ["A proposal got money", "Updates come in", "Check on a crew you voted for"],
  tweet:
    "Funded is not finished. Propdates are the progress reports from every Gnars proposal that got money: what got done, what's next. Check on a crew you voted for. https://gnars.com/propdates",
  assets: { photo: `${A}/rails/kenya.jpg` },
  draw(p, t) {
    p.card(-250, -240, 500, 480);
    if (!p.imageCover("photo", -250, -240, 500, 140, 26, { zoom: 1.06 + t * 0.008, dx: -t * 2 })) p.rect(-250, -240, 500, 140, p.c.surface2, 26);
    const shade = p.ctx.createLinearGradient(0, -240, 0, -100);
    shade.addColorStop(0, "#00000010");
    shade.addColorStop(1, p.c.surface + "f5");
    p.rect(-250, -240, 500, 140, shade, 26);
    p.pill(-222, -222, "PROP 118 · EXECUTED", { active: true });
    p.text("Skate Across Africa", -222, -130, 24, p.c.text, 800);
    p.text("Uganda → South Africa, one push at a time", -222, -104, 13, p.c.muted, 500);
    const updates: [string, string, boolean][] = [["Kampala sessions filmed", "Update 1 · 2 crews, 4 spots", true], ["Nairobi rail installed", "Update 2 · with the NogglesRail PDF", true], ["Next: Dar es Salaam", "Update 3 · in progress", false]];
    p.line(-196, -74, -196, 150, p.c.border, 2);
    updates.forEach(([title, meta, done], i) => {
      p.reveal(i, 1.2, 1.6, () => {
        const y = -54 + i * 78;
        p.rect(-212, y - 16, 32, 32, done ? p.c.accent + "30" : p.c.surface2, 16, done ? p.c.accent + "60" : p.c.border);
        if (done) p.check(-196, y, 6);
        else p.circle(-196, y, 4 + Math.sin(t * 4) * 1.5, p.c.accent);
        p.text(title, -164, y + 5, 17, done ? p.c.text : p.c.muted, 700);
        p.text(meta, -164, y + 26, 12, p.c.muted, 500);
      });
    });
    p.fade(6.4, 0.5, () => {
      p.text("2 OF 3 MILESTONES", -222, 190, 11, p.c.muted, 650);
      p.progress(-222, 200, 444, 0.66 * out((t - 6.4) / 1.2));
    });
  },
};

const treasury: FeatureFilm = {
  id: "treasury",
  label: "Treasury",
  url: "gnars.com/treasury",
  tweetDoc: "Tweet 10",
  seconds: 10,
  headline: ["Public,", "down to the line."],
  subtitle: "What the riders' vaults earn for the DAO",
  steps: ["Sponsorship yield", "Vault fee and MOR rewards", "Depositors keep their principal"],
  tweet:
    "The Gnars treasury is public down to the line: what the riders' vaults earned, the fee the DAO takes, the MOR from the Morpheus stake. Depositors keep their principal, only the yield is split. https://gnars.com/treasury",
  exampleValues: true,
  assets: { mor: `${A}/morpheus.webp`, base: "public:/tokens/base.png" },
  draw(p, t) {
    p.card(-250, -240, 500, 480);
    p.text("Treasury", -222, -190, 24, p.c.text, 700);
    p.pill(122, -212, "EXAMPLE AMOUNTS", {});
    p.sparkline([0.2, 0.28, 0.24, 0.36, 0.42, 0.4, 0.55, 0.6, 0.58, 0.72, 0.8, 0.86], -222, -168, 444, 44, (t - 0.4) / 2.6);
    const stats: [string, number, string, number, string][] = [["Sponsorship yield", 1240, "USDC", 1.2, "Morpho vaults"], ["Vault fee", 310, "USDC", 1.7, "Morpho vaults"], ["MOR rewards", 7400, "MOR", 2.2, "Morpheus stake"]];
    stats.forEach(([label, value, unit, from, source], i) => {
      p.reveal(i, 1, 0.3, () => {
        const y = -106 + i * 84;
        p.row(-222, y, 444, 70, {});
        p.text(label.toUpperCase(), -204, y + 24, 11, p.c.muted, 650);
        p.text(`${countUp(t, from, value, 1.6).toLocaleString("en-US")} ${unit}`, -204, y + 56, 26, i === 2 ? p.c.accent : p.c.text, 800);
        if (i === 2) p.image("mor", 178, y + 22, 26, 26);
        else p.image("base", 178, y + 22, 26, 26);
        p.text(source, 172, y + 44, 12, p.c.muted, 500, "right");
      });
    });
    p.fade(6.2, 0.6, () => {
      const split = out((t - 6.2) / 1.2);
      p.text("PRINCIPAL", -222, 168, 11, p.c.muted, 650);
      p.text("YIELD, SPLIT", 222, 168, 11, p.c.muted, 650, "right");
      p.rect(-222, 178, 444, 14, p.c.surface2, 7);
      p.rect(-222, 178, 300 * split, 14, p.c.text + "70", 7);
      p.rect(78, 178, 144 * split, 14, p.c.accent, 7);
      p.text("Depositors keep it", -222, 214, 13, p.c.text, 600);
      p.text("riders + treasury", 222, 214, 13, p.c.accent, 600, "right");
    });
  },
};

// O accent dos filmes é o amarelo do logo (#fce560, 55% dos pixels), não o
// vermelho dos noggles que o portal usa como tema. Vermelho fica nos noggles
// e na escultura, que são vermelhos de verdade.
export const gnarsFilms: FilmSet = {
  brand: { name: "Gnars", site: "gnars.com", accent: "#fce560" },
  films: [auctions, proposals, bounties, droposals, swap, nogglesrails, stake, feed, propdates, treasury],
};
