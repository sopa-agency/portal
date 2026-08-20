// Curated emoji set for the in-app picker — no external dependency, just the
// emojis that actually show up in social copy. Each entry is [emoji, keywords]
// so the picker can filter by typing. Grouped into a few skim-able categories.

export type EmojiCategory = { id: string; label: string; emojis: [string, string][] };

export const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    id: "smileys",
    label: "Smileys",
    emojis: [
      ["😀", "grin happy"], ["😁", "grin beam"], ["😂", "joy laugh tears"], ["🤣", "rofl laugh"],
      ["😊", "smile blush"], ["😇", "innocent angel"], ["🙂", "slight smile"], ["😉", "wink"],
      ["😍", "heart eyes love"], ["🥰", "love hearts"], ["😘", "kiss"], ["😎", "cool sunglasses"],
      ["🤩", "star struck wow"], ["🥳", "party celebrate"], ["😏", "smirk"], ["😜", "tongue wink"],
      ["🤪", "crazy zany"], ["😴", "sleep"], ["🤔", "thinking hmm"], ["😅", "sweat smile"],
      ["😬", "grimace"], ["🙄", "eyeroll"], ["😤", "huff steam"], ["😭", "cry sob"],
      ["😱", "scream shock"], ["🤯", "mind blown"], ["🥺", "pleading"], ["😈", "devil mischief"],
    ],
  },
  {
    id: "gestures",
    label: "Gestures",
    emojis: [
      ["👍", "thumbs up like yes"], ["👎", "thumbs down no"], ["👏", "clap applause"], ["🙌", "raise hands praise"],
      ["🤝", "handshake deal"], ["✊", "fist bump"], ["👊", "punch fist"], ["🤙", "shaka call hang loose"],
      ["✌️", "peace victory"], ["🤘", "rock horns"], ["👌", "ok perfect"], ["🫶", "heart hands love"],
      ["🙏", "pray thanks please"], ["💪", "muscle strong flex"], ["🫡", "salute respect"], ["👀", "eyes look watch"],
      ["🤌", "pinch chef italian"], ["☝️", "point up"], ["👇", "point down"], ["👉", "point right"],
    ],
  },
  {
    id: "hearts",
    label: "Hearts",
    emojis: [
      ["❤️", "red heart love"], ["🧡", "orange heart"], ["💛", "yellow heart"], ["💚", "green heart"],
      ["💙", "blue heart"], ["💜", "purple heart"], ["🖤", "black heart"], ["🤍", "white heart"],
      ["💔", "broken heart"], ["❤️‍🔥", "heart fire"], ["💕", "two hearts"], ["💖", "sparkle heart"],
      ["💗", "growing heart"], ["💯", "hundred perfect"], ["💢", "anger"], ["💥", "boom collision"],
    ],
  },
  {
    id: "hype",
    label: "Hype",
    emojis: [
      ["🔥", "fire lit hot"], ["⚡", "lightning bolt energy"], ["✨", "sparkles shine"], ["🌟", "glowing star"],
      ["⭐", "star"], ["🚀", "rocket launch moon"], ["🎉", "party tada celebrate"], ["🎊", "confetti"],
      ["🏆", "trophy win champion"], ["🥇", "gold medal first"], ["💰", "money bag"], ["💸", "money wings"],
      ["🤑", "money face"], ["📈", "chart up growth"], ["📉", "chart down"], ["🎯", "target bullseye"],
      ["💎", "diamond gem"], ["👑", "crown king"], ["🆕", "new"], ["🔝", "top up"],
      ["‼️", "exclamation"], ["⁉️", "interrobang"], ["✅", "check yes done"], ["❌", "cross no"],
    ],
  },
  {
    id: "sports",
    label: "Skate & Sports",
    emojis: [
      ["🛹", "skateboard skate"], ["🛼", "roller skates"], ["🏂", "snowboard"], ["🚲", "bike bmx"],
      ["🏄", "surf"], ["🤙", "shaka skate"], ["⛹️", "baller"], ["🏅", "medal sports"],
      ["🎮", "game controller arcade"], ["🕹️", "joystick arcade"], ["📹", "video camera film"], ["🎬", "clapper film"],
      ["📸", "camera photo"], ["🎥", "movie camera"], ["🎨", "art palette"], ["🎵", "music note"],
    ],
  },
  {
    id: "objects",
    label: "Objects",
    emojis: [
      ["📣", "megaphone announce"], ["📢", "loudspeaker announce"], ["📌", "pin"], ["📍", "location pin"],
      ["🗓️", "calendar date"], ["⏰", "alarm clock time"], ["⏳", "hourglass wait"], ["🔗", "link chain"],
      ["💡", "idea bulb"], ["🔓", "unlock"], ["🔒", "lock"], ["🔑", "key"],
      ["📨", "email mail"], ["✉️", "envelope email"], ["💬", "speech bubble comment"], ["🗣️", "speaking shout"],
      ["🧵", "thread"], ["🌐", "globe web"], ["🤖", "robot bot ai"], ["⚙️", "gear settings"],
    ],
  },
  {
    id: "nature",
    label: "Nature",
    emojis: [
      ["🌎", "earth globe world"], ["🌊", "wave water ocean"], ["☀️", "sun"], ["🌙", "moon night"],
      ["⛰️", "mountain"], ["🌴", "palm tree"], ["🍕", "pizza"], ["🍻", "beers cheers"],
      ["☕", "coffee"], ["🌮", "taco"], ["🎃", "pumpkin halloween"], ["❄️", "snow cold"],
      ["🐍", "snake"], ["🦅", "eagle"], ["🐺", "wolf"], ["🦄", "unicorn"],
    ],
  },
];

/** Flatten + filter by a free-text query against the keyword list. */
export function searchEmojis(query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: string[] = [];
  for (const cat of EMOJI_CATEGORIES) {
    for (const [emoji, keywords] of cat.emojis) {
      if (keywords.includes(q) || keywords.split(/\s+/).some((k) => k.startsWith(q))) {
        out.push(emoji);
      }
    }
  }
  return out;
}
