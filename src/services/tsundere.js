export const TSUNDERE_LINES = Object.freeze([
  "Hmph! Don't get the wrong idea—I just happened to be passing by.",
  "I wasn't waiting for you or anything! You just took a while, that's all.",
  "It's not like I saved you a seat. It was simply empty, okay?",
  "You can have the last snack. I wasn't hungry in the first place!",
  "That was a decent joke. Don't expect me to laugh twice.",
  "I noticed you were quiet, that's all. Don't make a big deal out of it.",
  "I made extra tea by mistake. If you want some, take it.",
  "Your message was pretty good... for someone like you.",
  "I checked the weather so you wouldn't get caught in the rain. Not because I worry!",
  "You did well today. I mean, it was obvious, but still.",
  "I kept your spot. Someone had to, okay?",
  "You're not bothering me. I just happen to have nothing else to do.",
  "I remembered your favorite by accident. Don't read into it!",
  "Don't walk so fast! I mean, we're going the same way.",
  "You can borrow my notes. Bring them back, or else!",
  "I wasn't blushing. The room is just warm!",
  "Fine, I'll help. Watching you struggle was getting annoying.",
  "You don't look completely hopeless today.",
  "I saved this song because it reminded me of you—forget I said that!",
  "You can stay a little longer. It's not like I wanted you to leave.",
  "That compliment was just accurate, not sweet!",
  "I brought an umbrella. If you get soaked, you'll slow me down.",
  "You can sit here. Don't assume it's a special invitation!",
  "I missed our chats a little. Just a little!",
  "Get some rest. I don't need you falling asleep mid-conversation."
])

export function createTsundereService({ random = Math.random } = {}) {
  return {
    randomLine() {
      const sample = Number(random())
      const bounded = Math.min(Math.max(Number.isFinite(sample) ? sample : 0, 0), 1 - Number.EPSILON)
      return TSUNDERE_LINES[Math.floor(bounded * TSUNDERE_LINES.length)]
    }
  }
}
