import { createContext, useContext, useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "imbored-language";
const SUPPORTED = ["en", "sk"];

const translations = {
  en: {
    "common.loading": "Loading…",
    "common.signOut": "Sign out",
    "common.challenge": "Challenge",
    "common.practice": "Practice",
    "common.player": "player",
    "common.players": "Players",
    "common.games": "Games",
    "common.rewards": "Rewards",
    "common.admin": "Admin",
    "common.backHome": "Back to all games",
    "common.undo": "Undo",
    "common.reset": "Reset",
    "common.restart": "Restart",
    "common.hint": "Hint",
    "common.todaysChallenge": "Today’s Challenge",
    "common.buildingPuzzle": "Building today’s puzzle…",
    "common.buildingQuiz": "Building today’s quiz…",
    "common.solved": "Solved",
    "common.noPoints": "No Points awarded",
    "common.erase": "Erase",
    "common.nextQuestion": "Next question",
    "common.seeResults": "See results",
    "language.label": "Language",
    "language.english": "English",
    "language.slovak": "Slovenčina",
    "language.autoHint": "Chosen automatically from your device. You can change it anytime.",
    "auth.tagline": "sign in to track your stats and play with friends",
    "auth.passkey": "Sign in with a passkey",
    "auth.waiting": "Waiting…",
    "auth.passkeyHint": "Only works if you’ve registered one on this device before — otherwise use an option below.",
    "auth.google": "Continue with Google",
    "auth.or": "or",
    "auth.email": "Email address",
    "auth.sendCode": "Send sign-in code",
    "auth.sending": "Sending…",
    "auth.noPassword": "No password — we’ll email you a one-time code instead.",
    "auth.codeSent": "We sent an 8-digit code to {email}.",
    "auth.codeLabel": "Sign-in code",
    "auth.verify": "Verify and sign in",
    "auth.checking": "Checking…",
    "auth.changeEmail": "Use a different email",
    "auth.resend": "Resend code",
    "auth.resendIn": "Resend in {seconds}s",
    "auth.invalidCodeLength": "Enter the 8-digit code from your email.",
    "auth.invalidCode": "That code didn’t work — check it and try again, or resend below.",
    "home.tagline": "new puzzles every day — Monday easiest, Sunday hardest",
    "home.points": "Points",
    "home.day": "day",
    "home.days": "days",
    "home.challengeHint": "one attempt a day, same puzzle for everyone — today only",
    "home.practiceHint": "any day, unlimited puzzles — nothing saved to your stats",
    "home.todaysChallenge": "Today’s challenge",
    "home.myChallenge": "My Challenge",
    "home.allDailyGames": "All daily games",
    "home.gamesCount": "{count} games · {points} pts",
    "home.playing": "{count} playing",
    "home.alreadyPlayed": "Already played today",
    "home.comingSoon": "Coming soon",
    "home.chooseChallenge": "Choose a challenge",
    "home.personalOrTeams": "Personal or one of your teams",
    "home.notToday": "Not today",
    "home.members": "{count} members",
    "home.member": "1 member",
    "home.manageTeams": "Manage teams",
    "game.queens.desc": "One crown per row, column & region",
    "game.tango.desc": "Balance sun & moon in every line",
    "game.zip.desc": "Trace one path through every cell",
    "game.pinpoint.desc": "Guess the category from five clues",
    "game.crossclimb.desc": "Solve the word ladder",
    "game.minisudoku.desc": "Classic sudoku, bite-sized",
    "game.patches.desc": "Fit every shape into the frame",
    "game.wend.desc": "Weave hidden words through the grid",
    "game.geo.desc": "Capitals, landmarks & wildlife by continent",
    "account.open": "Open account menu",
    "account.myProfile": "My profile",
    "account.whatsNew": "What’s new",
    "account.chats": "Chats",
    "account.feedback": "Feedback",
    "account.stats": "Stats",
    "account.progress": "My progress",
    "account.teams": "Teams",
    "account.adminTools": "Admin tools",
    "account.updates": "You have updates",
    "account.newPoints": "You have new points and updates",
    "account.update": "update",
    "profile.welcome": "Welcome",
    "profile.title": "My Profile",
    "profile.firstHint": "{email} — just need a name to get started",
    "profile.name": "Display name",
    "profile.namePlaceholder": "e.g. Jamie",
    "profile.mood": "Status",
    "profile.moodPlaceholder": "What’s your mood?",
    "profile.defaultMode": "Default play mode",
    "profile.weekStarts": "Week starts on",
    "profile.monday": "Monday",
    "profile.sunday": "Sunday",
    "profile.showStats": "Show my stats to others",
    "profile.statsPublic": "Other players can see your totals and daily results",
    "profile.statsPrivate": "Only you and administrators can see your stats",
    "profile.private": "Private profile",
    "profile.privateOn": "Only teammates and administrators can find you",
    "profile.privateOff": "Other players can find you and invite you to teams",
    "profile.save": "Save changes",
    "profile.saving": "Saving…",
    "profile.start": "Start playing",
    "profile.teams": "My teams",
    "pending.label": "Approval pending",
    "pending.title": "You’re almost ready, {name}",
    "pending.body": "An admin needs to approve your account before you can play, join teams, chat or view other players.",
    "pending.auto": "This screen will unlock automatically as soon as an admin approves you—no refreshing or repeated checks in the background.",
    "pending.check": "Check approval",
    "blocked.title": "Account blocked",
    "blocked.body": "You cannot access I’mBoredToday while this account is blocked.",
    "challenge.notIncluded": "{game} isn’t in this team challenge",
    "challenge.notIncludedBody": "{team} didn’t include this game this week. You can play your personal challenge or choose another team challenge.",
    "challenge.playMine": "Play my challenge",
    "challenge.chooseAnother": "Choose another challenge",
    "challenge.stayPractice": "Stay in practice",
  },
  sk: {
    "common.loading": "Načítava sa…",
    "common.signOut": "Odhlásiť sa",
    "common.challenge": "Výzva",
    "common.practice": "Tréning",
    "common.player": "hráč",
    "common.players": "Hráči",
    "common.games": "Hry",
    "common.rewards": "Odmeny",
    "common.admin": "Admin",
    "common.backHome": "Späť na všetky hry",
    "common.undo": "Späť",
    "common.reset": "Vynulovať",
    "common.restart": "Začať znova",
    "common.hint": "Pomôcka",
    "common.todaysChallenge": "Dnešná výzva",
    "common.buildingPuzzle": "Pripravuje sa dnešný hlavolam…",
    "common.buildingQuiz": "Pripravuje sa dnešný kvíz…",
    "common.solved": "Vyriešené",
    "common.noPoints": "Bez bodovej odmeny",
    "common.erase": "Vymazať",
    "common.nextQuestion": "Ďalšia otázka",
    "common.seeResults": "Zobraziť výsledky",
    "language.label": "Jazyk",
    "language.english": "English",
    "language.slovak": "Slovenčina",
    "language.autoHint": "Vybrané automaticky podľa zariadenia. Jazyk môžete kedykoľvek zmeniť.",
    "auth.tagline": "prihláste sa, sledujte výsledky a hrajte s priateľmi",
    "auth.passkey": "Prihlásiť sa prístupovým kľúčom",
    "auth.waiting": "Čaká sa…",
    "auth.passkeyHint": "Funguje iba vtedy, ak ste si na tomto zariadení už vytvorili prístupový kľúč.",
    "auth.google": "Pokračovať cez Google",
    "auth.or": "alebo",
    "auth.email": "E-mailová adresa",
    "auth.sendCode": "Poslať prihlasovací kód",
    "auth.sending": "Odosiela sa…",
    "auth.noPassword": "Bez hesla — pošleme vám jednorazový kód e-mailom.",
    "auth.codeSent": "Na adresu {email} sme poslali 8-miestny kód.",
    "auth.codeLabel": "Prihlasovací kód",
    "auth.verify": "Overiť a prihlásiť sa",
    "auth.checking": "Overuje sa…",
    "auth.changeEmail": "Použiť iný e-mail",
    "auth.resend": "Poslať kód znova",
    "auth.resendIn": "Znova poslať o {seconds} s",
    "auth.invalidCodeLength": "Zadajte 8-miestny kód z e-mailu.",
    "auth.invalidCode": "Tento kód nefunguje — skontrolujte ho alebo si pošlite nový.",
    "home.tagline": "nové hlavolamy každý deň — pondelok najľahší, nedeľa najťažšia",
    "home.points": "bodov",
    "home.day": "deň",
    "home.days": "dní",
    "home.challengeHint": "jeden pokus denne, rovnaký hlavolam pre všetkých — iba dnes",
    "home.practiceHint": "ľubovoľný deň, neobmedzené hry — výsledky sa neukladajú",
    "home.todaysChallenge": "Dnešná výzva",
    "home.myChallenge": "Moja výzva",
    "home.allDailyGames": "Všetky denné hry",
    "home.gamesCount": "{count} hier · {points} bodov",
    "home.playing": "hrá: {count}",
    "home.alreadyPlayed": "Dnes už odohrané",
    "home.comingSoon": "Už čoskoro",
    "home.chooseChallenge": "Vyberte si výzvu",
    "home.personalOrTeams": "Osobná alebo tímová",
    "home.notToday": "Dnes sa nehrá",
    "home.members": "{count} členov",
    "home.member": "1 člen",
    "home.manageTeams": "Spravovať tímy",
    "game.queens.desc": "Jedna koruna v každom riadku, stĺpci a oblasti",
    "game.tango.desc": "Vyvážte slnko a mesiac v každom riadku",
    "game.zip.desc": "Prejdite jednou cestou cez všetky políčka",
    "game.pinpoint.desc": "Uhádnite kategóriu z piatich indícií",
    "game.crossclimb.desc": "Vyriešte slovný rebrík",
    "game.minisudoku.desc": "Klasické sudoku v malom",
    "game.patches.desc": "Vložte všetky tvary do rámu",
    "game.wend.desc": "Nájdite skryté slová v mriežke",
    "game.geo.desc": "Hlavné mestá, pamiatky a zvieratá podľa kontinentov",
    "account.open": "Otvoriť menu účtu",
    "account.myProfile": "Môj profil",
    "account.whatsNew": "Čo je nové",
    "account.chats": "Správy",
    "account.feedback": "Spätná väzba",
    "account.stats": "Štatistiky",
    "account.progress": "Môj pokrok",
    "account.teams": "Tímy",
    "account.adminTools": "Nástroje admina",
    "account.updates": "Máte nové upozornenia",
    "account.newPoints": "Máte nové body a upozornenia",
    "account.update": "nové",
    "profile.welcome": "Vitajte",
    "profile.title": "Môj profil",
    "profile.firstHint": "{email} — na začiatok potrebujeme už len meno",
    "profile.name": "Zobrazované meno",
    "profile.namePlaceholder": "napr. Jano",
    "profile.mood": "Stav",
    "profile.moodPlaceholder": "Ako sa máte?",
    "profile.defaultMode": "Predvolený režim hry",
    "profile.weekStarts": "Týždeň začína",
    "profile.monday": "V pondelok",
    "profile.sunday": "V nedeľu",
    "profile.showStats": "Zobrazovať moje štatistiky ostatným",
    "profile.statsPublic": "Ostatní hráči uvidia vaše súčty a denné výsledky",
    "profile.statsPrivate": "Vaše výsledky uvidíte iba vy a administrátori",
    "profile.private": "Súkromný profil",
    "profile.privateOn": "Nájdu vás iba spoluhráči a administrátori",
    "profile.privateOff": "Ostatní hráči vás môžu nájsť a pozvať do tímu",
    "profile.save": "Uložiť zmeny",
    "profile.saving": "Ukladá sa…",
    "profile.start": "Začať hrať",
    "profile.teams": "Moje tímy",
    "pending.label": "Čaká sa na schválenie",
    "pending.title": "Už ste takmer pripravený, {name}",
    "pending.body": "Pred hraním, vstupom do tímov, četovaním alebo zobrazením hráčov musí váš účet schváliť administrátor.",
    "pending.auto": "Táto obrazovka sa odomkne automaticky po schválení — bez obnovovania stránky alebo opakovaných kontrol.",
    "pending.check": "Skontrolovať schválenie",
    "blocked.title": "Účet je zablokovaný",
    "blocked.body": "Kým je tento účet zablokovaný, nemôžete používať I’mBoredToday.",
    "challenge.notIncluded": "{game} nie je súčasťou tejto tímovej výzvy",
    "challenge.notIncludedBody": "Tím {team} túto hru tento týždeň nezahrnul. Môžete hrať osobnú výzvu alebo si vybrať inú tímovú výzvu.",
    "challenge.playMine": "Hrať moju výzvu",
    "challenge.chooseAnother": "Vybrať inú výzvu",
    "challenge.stayPractice": "Zostať v tréningu",
  },
};

function detectLanguage() {
  if (typeof window === "undefined") return "en";
  let stored = null;
  try {
    stored = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Private browsing or embedded browsers may block local storage.
  }
  if (SUPPORTED.includes(stored)) return stored;

  const languages = navigator.languages?.length ? navigator.languages : [navigator.language];
  const hasSlovakLocale = languages.some((value) => /^sk(?:-|$)/i.test(value || ""));
  let timeZone = "";
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    // Locale remains a sufficient fallback when timezone APIs are unavailable.
  }
  return hasSlovakLocale || timeZone === "Europe/Bratislava" ? "sk" : "en";
}

function interpolate(value, variables = {}) {
  return value.replace(/\{(\w+)\}/g, (_, key) => variables[key] ?? `{${key}}`);
}

const I18nContext = createContext(null);

export function I18nProvider({ children }) {
  const [language, setLanguageState] = useState(detectLanguage);

  function setLanguage(next) {
    const safeLanguage = SUPPORTED.includes(next) ? next : "en";
    try {
      window.localStorage.setItem(STORAGE_KEY, safeLanguage);
    } catch {
      // The current session still changes even if persistence is unavailable.
    }
    setLanguageState(safeLanguage);
  }

  useEffect(() => {
    document.documentElement.lang = language === "sk" ? "sk-SK" : "en";
  }, [language]);

  const value = useMemo(() => ({
    language,
    setLanguage,
    t(key, variables) {
      const value = translations[language]?.[key] ?? translations.en[key] ?? key;
      return interpolate(value, variables);
    },
  }), [language]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used inside I18nProvider");
  return context;
}
