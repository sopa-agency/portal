// Os 10 filmes da Gnars, um por tweet da campanha "Gnars.com features"
// (gnars.sopa.team/campaign-creator/cmu2vin8p0000l804sdd63aej). Cada cena
// recria a página em primitivas e anima UMA interação, como função pura do
// tempo. Todo número na tela é exemplo, nunca uma medição.

import type { FeatureFilm, FilmSet } from "./types";
import { at, caretOn, clickAt, countUp, cursorAt, out, smooth, stage, typed } from "./take";

const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

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
  assets: { screen: "drive:screens/auctions.png" },
  captionAt: (t) => stage(t, [[2.7, "Open the live auction"], [5.6, "Place a bid"], [8.5, "Bid placed"]] as const, "Hold a vote in the DAO"),
  draw(p, t) {
    const s = stage(t, [[2.7, "browse"], [5.6, "bid"], [6.1, "pressing"]] as const, "placed");
    const cursor = cursorAt(t, [{ at: 0.6, x: 210, y: 210 }, { at: 2.4, x: 70, y: 128 }, { at: 3.1, x: 70, y: 128 }, { at: 5.2, x: 0, y: 204 }, { at: 6.4, x: 0, y: 204 }, { at: 7.4, x: 230, y: 250 }], [2.7, 5.6], 0.5, 7.4);
    p.card(-250, -240, 500, 480);
    p.noggles(-222, -212, 34);
    p.text("Gnar 2318", -172, -190, 22, p.c.text, 700);
    p.pill(146, -214, "LIVE", { active: true });
    // Hero: screenshot real quando existe no Drive; senão, os noggles grandes.
    if (!p.imageCover("screen", -222, -168, 444, 130, 14)) {
      p.rect(-222, -168, 444, 130, p.c.surface2, 14);
      p.noggles(-64, -128, 130);
    }
    p.text("CURRENT BID", -222, -8, 11, p.c.muted, 650);
    p.text(s === "placed" ? "0.45 ETH" : "0.42 ETH", -222, 26, 30, s === "placed" ? p.c.accent : p.c.text, 800);
    p.text("ENDS IN", 222, -8, 11, p.c.muted, 650, "right");
    p.text(mmss(Math.max(0, 299 - Math.floor(t))), 222, 26, 30, p.c.text, 800, "right");
    if (s === "placed") {
      p.fade(6.1, 0.4, () => {
        p.rect(-222, 60, 444, 110, p.c.accent + "18", 14, p.c.accent + "60");
        p.check(-196, 92, 9);
        p.text("Bid placed · 0.45 ETH", -176, 98, 18, p.c.text, 700);
        p.fade(7, 0.5, () => p.text("Win it and you hold one vote in the DAO.", -196, 132, 14, p.c.muted, 500));
      });
    } else {
      const value = typed("0.45", t, 3.1, 4.1);
      p.input(-222, 60, 444, 56, value ? `Ξ ${value}` : "", "Ξ 0.45 or more", { focused: s === "bid", caret: s === "bid" && t < 4.4 && caretOn(t), size: 20 });
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
  captionAt: (t) => stage(t, [[3.2, "Read how they pitched"], [7.5, "Open one and see the vote"]] as const, "Vote, then write yours"),
  draw(p, t) {
    const opened = at(t, 3.4, 0.5);
    const cursor = cursorAt(t, [{ at: 0.6, x: 230, y: 230 }, { at: 2.9, x: -60, y: -150 }, { at: 3.6, x: -60, y: -150 }, { at: 7.1, x: -120, y: 196 }, { at: 8, x: -120, y: 196 }, { at: 9, x: 240, y: 250 }], [3.2, 7.5], 0.5, 9);
    const rows: [string, string, string][] = [
      ["NogglesRail in Medellín", "ACTIVE", "1.2 ETH"],
      ["Video part: Gnargentina", "EXECUTED", "0.8 ETH"],
      ["Skate trip to Nairobi", "QUEUED", "2.0 ETH"],
    ];
    p.ctx.save();
    p.ctx.globalAlpha *= 1 - opened;
    p.text("Proposals", -250, -222, 22, p.c.text, 700);
    p.pill(160, -244, "129 ON BASE", {});
    rows.forEach(([title, status, ask], i) => {
      p.reveal(i, 0.8, 0.25, () => {
        const y = -190 + i * 84;
        p.row(-250, y, 500, 70, { active: i === 0 && t > 2.9 });
        p.text(title, -228, y + 30, 17, p.c.text, 700);
        p.pill(-228, y + 40, status, { active: status === "ACTIVE", size: 10, height: 22 });
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
      p.pill(-222, -212, "PROP 131 · ACTIVE", { active: true });
      p.text("NogglesRail in Medellín", -222, -150, 24, p.c.text, 800);
      p.text("Requesting 1.2 ETH · by pharra.eth", -222, -122, 14, p.c.muted, 500);
      p.wrap("A CC0 rail for the Parque del Río spot, built from the open-source PDF. Local crew installs it; the DAO covers steel and transport.", -222, -84, 14, 444, p.c.muted, 500, 20, 3);
      const forShare = 0.78 * out((t - 4) / 1.8);
      p.text("FOR", -222, 0, 11, p.c.muted, 650);
      p.text(`${Math.round(forShare * 100)}%`, 222, 0, 11, p.c.accent, 700, "right");
      p.progress(-222, 10, 444, forShare, { height: 10 });
      p.text(`${countUp(t, 4, 834, 1.8)} votes · ends in 2 days`, -222, 50, 13, p.c.muted, 500);
      const voted = t >= 8;
      if (voted) {
        p.fade(8, 0.4, () => {
          p.rect(-222, 176, 444, 52, p.c.accent + "18", 26, p.c.accent + "60");
          p.check(-40, 202, 8);
          p.text("Voted for", -20, 208, 16, p.c.text, 700);
        });
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
  captionAt: (t) => stage(t, [[4.8, "Pick a bounty"], [7.8, "Upload the proof"]] as const, "Paid onchain"),
  draw(p, t) {
    const s = stage(t, [[4.8, "open"], [5.3, "claiming"], [7.8, "uploading"]] as const, "paid");
    const cursor = cursorAt(t, [{ at: 0.6, x: 220, y: 220 }, { at: 4.4, x: 0, y: 204 }, { at: 5.2, x: 0, y: 204 }, { at: 6.2, x: 230, y: 250 }], [4.8], 0.5, 6.2);
    p.card(-250, -240, 500, 480);
    p.pill(-222, -212, "OPEN · SKATE", { active: true });
    p.text("Impossible late flip", -222, -150, 26, p.c.text, 800);
    p.text("Say “this is for poidh”, land it, no cuts. Slow-mo replay welcome.", -222, -120, 14, p.c.muted, 500);
    p.text("REWARD", -222, -74, 11, p.c.muted, 650);
    p.text("0.023 ETH", -222, -40, 30, p.c.accent, 800);
    p.text("ESCROW", 222, -74, 11, p.c.muted, 650, "right");
    p.text("POIDH V3", 222, -40, 20, p.c.text, 700, "right");
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
  assets: { screen: "drive:screens/droposals.png" },
  captionAt: (t) => stage(t, [[3.5, "Scrub the archive"], [6.5, "Open a part"]] as const, "Minted as an NFT"),
  draw(p, t) {
    const opened = at(t, 3.7, 0.5);
    const cursor = cursorAt(t, [{ at: 0.6, x: 230, y: 230 }, { at: 3.1, x: -170, y: -140 }, { at: 3.8, x: -170, y: -140 }, { at: 5, x: 240, y: 250 }], [3.5], 0.5, 5);
    const titles = ["Gnargentina", "Surf is Up", "Skate Across Africa", "Gnar Connect Rio", "Nogglesboard", "7Ctv"];
    p.ctx.save();
    p.ctx.globalAlpha *= 1 - opened;
    p.text("Droposals", -250, -222, 22, p.c.text, 700);
    p.pill(178, -244, "ARCHIVE", {});
    titles.forEach((title, i) => {
      p.reveal(i, 0.7, 0.18, () => {
        const x = -250 + (i % 3) * 170, y = -190 + Math.floor(i / 3) * 150;
        p.rect(x, y, 160, 100, `hsl(${(i * 47 + 340) % 360} 20% ${16 + (i % 2) * 4}%)`, 12, i === 0 && t > 3.1 ? p.c.accent + "70" : p.c.border);
        p.circle(x + 80, y + 50, 17, "#00000080");
        p.ctx.beginPath(); p.ctx.moveTo(x + 75, y + 41); p.ctx.lineTo(x + 75, y + 59); p.ctx.lineTo(x + 89, y + 50); p.ctx.closePath(); p.ctx.fillStyle = p.c.text; p.ctx.fill();
        p.text(title, x, y + 124, 13, p.c.text, 600);
      });
    });
    p.ctx.restore();
    if (opened > 0) {
      p.ctx.save();
      p.ctx.globalAlpha *= opened;
      p.ctx.scale(0.9 + opened * 0.1, 0.9 + opened * 0.1);
      p.card(-250, -240, 500, 480);
      if (!p.imageCover("screen", -222, -212, 444, 250, 14)) {
        p.rect(-222, -212, 444, 250, "hsl(340 20% 16%)", 14);
        p.noggles(-40, -110, 80);
      }
      p.circle(0, -87, 30, "#000000a0");
      p.ctx.beginPath(); p.ctx.moveTo(-8, -102); p.ctx.lineTo(-8, -72); p.ctx.lineTo(16, -87); p.ctx.closePath(); p.ctx.fillStyle = p.c.text; p.ctx.fill();
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
  captionAt: (t) => stage(t, [[2.2, "Choose what you pay"], [5, "Enter the amount"], [7.6, "Tick “Support Gnars treasury”"], [9.4, "Review the swap"]] as const, "Scripted walkthrough · example amounts"),
  draw(p, t) {
    const s = stage(t, [[2.2, "idle"], [5, "typing"], [7.6, "ticking"], [8.1, "pressing"]] as const, "review");
    const cursor = cursorAt(t, [{ at: 0.6, x: 220, y: 220 }, { at: 1.9, x: 150, y: -130 }, { at: 2.5, x: 150, y: -130 }, { at: 4.6, x: -205, y: 92 }, { at: 5.4, x: -205, y: 92 }, { at: 7.3, x: 0, y: 204 }, { at: 8.3, x: 0, y: 204 }, { at: 9.2, x: 240, y: 250 }], [2.2, 5, 7.6], 0.5, 9.2);
    const amount = typed("0.1", t, 2.5, 3.3);
    const ticked = t >= 5;
    p.card(-250, -240, 500, 480);
    if (s === "review") {
      p.fade(8.1, 0.4, () => {
        p.text("Review swap", -222, -190, 24, p.c.text, 700);
        p.text("0.1 ETH", -122, -100, 28, p.c.text, 800, "center");
        p.text("→", 0, -100, 28, p.c.accent, 500, "center");
        p.text("128.4 MOR", 122, -100, 28, p.c.accent, 800, "center");
        p.text("Ethereum · Base", -122, -74, 12, p.c.muted, 500, "center");
        p.text("Morpheus · Base", 122, -74, 12, p.c.muted, 500, "center");
        p.rect(-222, -40, 444, 130, p.c.surface2, 16, p.c.border);
        [["Route", "Best of 150+ DEXes"], ["Support Gnars treasury", "0.5% · on"], ["Example amounts", "scripted walkthrough"]].forEach(([k, v], i) => {
          p.text(k, -204, -8 + i * 38, 13, p.c.muted, 500);
          p.text(v, 204, -8 + i * 38, 13, i === 1 ? p.c.accent : p.c.text, 600, "right");
        });
        p.button(-222, 176, 444, 52, "Confirm swap", {});
      });
    } else {
      p.text("Swap", -222, -190, 24, p.c.text, 700);
      p.text("Base · 150+ DEXes", 222, -192, 12, p.c.muted, 600, "right");
      p.text("YOU PAY", -222, -152, 11, p.c.muted, 650);
      p.row(-222, -140, 190, 56, { active: t > 1.9 });
      p.circle(-194, -112, 14, "#627eea");
      p.text("ETH", -172, -105, 18, p.c.text, 700);
      p.text(amount || "0", 222, -100, 32, amount ? p.c.text : p.c.dim, 700, "right");
      if (s === "typing" && t < 3.6 && caretOn(t)) p.line(226, -128, 226, -98, p.c.accent, 2);
      p.line(-222, -66, 222, -66);
      p.rect(-21, -87, 42, 42, p.c.surface2, 21, p.c.border);
      p.text("↓", 0, -59, 20, p.c.accent, 500, "center");
      p.text("YOU RECEIVE", -222, -34, 11, p.c.muted, 650);
      p.row(-222, -22, 190, 56, {});
      p.circle(-194, 6, 14, "#1f8f5f");
      p.text("MOR", -172, 13, 18, p.c.text, 700);
      p.text(amount ? "128.4" : "—", 222, 18, 32, amount ? p.c.accent : p.c.dim, 700, "right");
      p.rect(-222, 60, 444, 46, ticked ? p.c.accent + "18" : p.c.surface2, 12, ticked ? p.c.accent + "60" : p.c.border);
      p.rect(-208, 73, 20, 20, ticked ? p.c.accent : "#0c0c0e", 5, ticked ? p.c.accent : p.c.border);
      if (ticked) p.check(-198, 83, 5, p.c.onAccent);
      p.text("Support Gnars treasury (0.5%)", -178, 89, 14, p.c.text, 600);
      p.text("skate spots, rails, trips", 206, 89, 11, p.c.muted, 500, "right");
      p.button(-222, 176, 444, 52, "Review swap", { enabled: !!amount, pressed: s === "pressing" ? clickAt(t, [7.6]) : 1 });
    }
    p.cursor(cursor);
  },
};

const RAIL_PINS: [string, number, number][] = [["Rio", 58, 62], ["Long Beach", -150, -18], ["Nairobi", 128, 24], ["Rusutsu", 175, -70], ["London", 60, -96], ["Medellín", -92, 40]];

const nogglesrails: FeatureFilm = {
  id: "nogglesrails",
  label: "NogglesRails",
  url: "gnars.com/nogglesrails",
  tweetDoc: "Tweet 6",
  seconds: 12,
  headline: ["A rail in your city", "is a proposal."],
  subtitle: "Community-funded, CC0, open-source build PDF",
  steps: ["Rails around the world", "All CC0, one open PDF", "No rail near you? Propose one"],
  tweet:
    "NogglesRails: community-funded skate rails from Praça XV in Rio to Nairobi to Rusutsu, all CC0, with an open-source build PDF anyone can copy. No rail in your city? That's a proposal. https://gnars.com/nogglesrails",
  captionAt: (t) => stage(t, [[4.5, "Rails around the world"], [8, "All CC0, one open PDF"]] as const, "No rail near you? Propose one"),
  draw(p, t) {
    // Globo: anel + meridianos girando; pins caem em cascata.
    p.glow(0, -20, 230, p.c.accent + "18");
    p.ring(0, -20, 200, 0, Math.PI * 2, p.c.accent + "40", 1.5);
    for (let i = 0; i < 6; i++) {
      const phase = ((t * 0.25 + i / 6) % 1) * 2 - 1;
      p.ctx.beginPath();
      p.ctx.ellipse(0, -20, Math.abs(phase) * 200, 200, 0, 0, Math.PI * 2);
      p.ctx.strokeStyle = p.c.accent + "18";
      p.ctx.lineWidth = 1;
      p.ctx.stroke();
    }
    for (let i = 0; i < 4; i++) {
      p.ctx.beginPath();
      p.ctx.ellipse(0, -20, 200, 200 * (0.2 + i * 0.25), 0, 0, Math.PI * 2);
      p.ctx.strokeStyle = p.c.accent + "14";
      p.ctx.stroke();
    }
    RAIL_PINS.forEach(([city, x, y], i) => {
      const drop = out((t - 1 - i * 0.5) / 0.6);
      if (drop <= 0) return;
      const py = y - 20 - (1 - drop) * 60;
      p.ctx.save();
      p.ctx.globalAlpha *= drop;
      p.circle(x, py, 6, p.c.accent);
      p.ring(x, py, 6 + ((t * 1.5 + i) % 1) * 14, 0, Math.PI * 2, p.c.accent + "50", 1.5);
      p.text(city, x, py - 14, 12, p.c.text, 650, "center");
      p.ctx.restore();
    });
    p.noggles(-30, -252, 60);
    const statsIn = at(t, 6.4, 0.6);
    if (statsIn > 0) {
      p.ctx.save();
      p.ctx.globalAlpha *= statsIn;
      p.stat(-230, 236, String(countUp(t, 6.4, 16)), "rails", { size: 34 });
      p.stat(-40, 236, String(countUp(t, 6.6, 9)), "countries", { size: 34 });
      p.stat(150, 236, String(countUp(t, 6.8, 4)), "continents", { size: 34 });
      p.ctx.restore();
    }
    p.fade(8.2, 0.5, () => p.pill(-70, 186, "CC0 · OPEN-SOURCE PDF", { active: true }));
  },
};

const RIDERS = ["Vlad", "Yan", "r4to", "Pam"];

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
  captionAt: (t) => stage(t, [[2.8, "Pick a rider"], [5.5, "Deposit"], [8.2, "The yield is split in two"]] as const, "Your deposit stays yours"),
  draw(p, t) {
    const s = stage(t, [[2.8, "pick"], [5.5, "amount"], [8.2, "split"], [8.7, "pressing"]] as const, "staked");
    const cursor = cursorAt(t, [{ at: 0.6, x: 220, y: 220 }, { at: 2.5, x: -168, y: -150 }, { at: 3.2, x: -168, y: -150 }, { at: 4.4, x: 120, y: -30 }, { at: 5.2, x: 120, y: -30 }, { at: 7.9, x: 0, y: 204 }, { at: 9, x: 0, y: 204 }, { at: 9.8, x: 240, y: 250 }], [2.8, 4.7, 8.2], 0.5, 9.8);
    p.card(-250, -240, 500, 480);
    p.text("Stake or Die", -222, -190, 24, p.c.text, 700);
    p.text("PICK YOUR RIDER", -222, -152, 11, p.c.muted, 650);
    RIDERS.forEach((name, i) => {
      p.reveal(i, 0.6, 0.15, () => {
        const x = -222 + i * 112;
        const picked = i === 0 && t >= 2.8;
        p.rect(x, -140, 100, 88, picked ? p.c.accent + "18" : p.c.surface2, 14, picked ? p.c.accent + "70" : p.c.border);
        p.avatar(x + 50, -110, 20, name.slice(0, 1).toUpperCase(), (i * 90 + 340) % 360);
        p.text(name, x + 50, -66, 13, picked ? p.c.accent : p.c.text, 650, "center");
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
    } else p.button(-222, 176, 444, 52, "Stake", { enabled: !!amount, pressed: s === "pressing" ? clickAt(t, [8.2]) : 1 });
    p.cursor(cursor);
  },
};

const FEED_EVENTS: [string, string, string][] = [
  ["bid", "0.31 ETH bid on Gnar 2318", "now"],
  ["vote", "Vote FOR on Prop 131", "1m"],
  ["prop", "Prop 132 created: Itapetininga ramp", "3m"],
  ["bounty", "Bounty claimed: impossible late flip", "6m"],
  ["bid", "0.28 ETH bid on Gnar 2318", "9m"],
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
  draw(p, t) {
    p.card(-250, -240, 500, 480);
    p.circle(-214, -196, 5, p.c.accent);
    p.ring(-214, -196, 5 + ((t * 1.2) % 1) * 12, 0, Math.PI * 2, p.c.accent + "60", 1.5);
    p.text("Live feed", -198, -190, 22, p.c.text, 700);
    p.text("refreshes every 60 s", 222, -192, 12, p.c.muted, 600, "right");
    const shown = Math.min(FEED_EVENTS.length, Math.floor((t - 0.5) / 1.1) + 1);
    // O mais novo entra por cima e empurra os outros para baixo.
    for (let i = 0; i < shown; i++) {
      const idx = shown - 1 - i; // 0 = mais novo, no topo
      const enter = smooth((t - 0.5 - i * 1.1) / 0.45);
      const y = -150 + idx * 72 + (1 - enter) * -30;
      const [kind, label, when] = FEED_EVENTS[shown - 1 - idx];
      p.ctx.save();
      p.ctx.globalAlpha *= enter;
      p.row(-222, y, 444, 60, { active: idx === 0 });
      const color = kind === "bid" ? p.c.accent : kind === "vote" ? "#5ec8ff" : kind === "prop" ? "#ffd166" : "#9be15d";
      p.circle(-196, y + 30, 6, color);
      p.text(label, -176, y + 35, 15, p.c.text, 600);
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
  draw(p, t) {
    p.card(-250, -240, 500, 480);
    p.pill(-222, -212, "PROP 118 · EXECUTED", { active: true });
    p.text("Skate Across Africa", -222, -150, 24, p.c.text, 800);
    p.text("Uganda → South Africa, one push at a time", -222, -124, 13, p.c.muted, 500);
    const updates: [string, string, boolean][] = [["Kampala sessions filmed", "Update 1 · 2 crews, 4 spots", true], ["Nairobi rail installed", "Update 2 · with the NogglesRail PDF", true], ["Next: Dar es Salaam", "Update 3 · in progress", false]];
    p.line(-196, -90, -196, 150, p.c.border, 2);
    updates.forEach(([title, meta, done], i) => {
      p.reveal(i, 1.2, 1.6, () => {
        const y = -70 + i * 80;
        p.rect(-212, y - 16, 32, 32, done ? p.c.accent + "30" : p.c.surface2, 16, done ? p.c.accent + "60" : p.c.border);
        if (done) p.check(-196, y, 6);
        else p.circle(-196, y, 4 + Math.sin(t * 4) * 1.5, p.c.accent);
        p.text(title, -164, y + 5, 17, done ? p.c.text : p.c.muted, 700);
        p.text(meta, -164, y + 26, 12, p.c.muted, 500);
      });
    });
    p.fade(6.4, 0.5, () => {
      p.text("2 OF 3 MILESTONES", -222, 186, 11, p.c.muted, 650);
      p.progress(-222, 196, 444, 0.66 * out((t - 6.4) / 1.2));
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
  draw(p, t) {
    p.card(-250, -240, 500, 480);
    p.text("Treasury", -222, -190, 24, p.c.text, 700);
    p.pill(122, -212, "EXAMPLE AMOUNTS", {});
    const stats: [string, number, string, number][] = [["Sponsorship yield", 1240, "USDC", 0.8], ["Vault fee", 310, "USDC", 1.3], ["MOR rewards", 7400, "MOR", 1.8]];
    stats.forEach(([label, value, unit, from], i) => {
      p.reveal(i, 0.6, 0.3, () => {
        const y = -136 + i * 92;
        p.row(-222, y, 444, 76, {});
        p.text(label.toUpperCase(), -204, y + 26, 11, p.c.muted, 650);
        p.text(`${countUp(t, from, value, 1.6).toLocaleString("en-US")} ${unit}`, -204, y + 60, 28, i === 2 ? p.c.accent : p.c.text, 800);
        p.text(i === 2 ? "Morpheus stake" : "Morpho vaults", 204, y + 58, 12, p.c.muted, 500, "right");
      });
    });
    p.fade(6.2, 0.6, () => {
      const split = out((t - 6.2) / 1.2);
      p.text("PRINCIPAL", -222, 158, 11, p.c.muted, 650);
      p.text("YIELD, SPLIT", 222, 158, 11, p.c.muted, 650, "right");
      p.rect(-222, 168, 444, 14, p.c.surface2, 7);
      p.rect(-222, 168, 300 * split, 14, p.c.text + "70", 7);
      p.rect(78, 168, 144 * split, 14, p.c.accent, 7);
      p.text("Depositors keep it", -222, 206, 13, p.c.text, 600);
      p.text("riders + treasury", 222, 206, 13, p.c.accent, 600, "right");
    });
  },
};

export const gnarsFilms: FilmSet = {
  brand: { name: "Gnars", site: "gnars.com" },
  films: [auctions, proposals, bounties, droposals, swap, nogglesrails, stake, feed, propdates, treasury],
};
