# A+ Vault — hur man lägger till en video

Vault är sidan `/vault` (inte länkad i huvudmenyn — bara den som har länken hittar den). Den läser
`videos/manifest.json` och listar/spelar allt som står där. Att bara lägga en mp4-fil i en mapp gör
ingenting av sig själv — filen måste också få en rad i `manifest.json`.

Sidan har en sidomeny med sök och två sektioner:

- **01 Film** — våra egna filmer och serier (`"titles"` i manifestet): utvalt-banner, rader,
  hover-förhandsvisning, info-ruta med avsnitt och "Mer som detta", "Fortsätt titta", "Min lista"
  och en egen helskärmsspelare med "Hoppa över intro" och nedräkning till nästa avsnitt.
- **02 Live** — ett bibliotek med livesändningar från YouTube (`"lives"` i manifestet). De spelas i
  ett teaterläge direkt på sidan (`/vault?visa=live`).

Allt styrs av manifestet.

## Lägg till en film

1. Lägg mp4-filen här: `videos/mitt-projekt/mitt-projekt.mp4`
2. Lägg bilderna i `vault-art/` (se **Bilder** nedan).
3. Lägg till en post under `"titles"` i `manifest.json`:

```json
{
  "slug": "mitt-projekt",
  "type": "movie",
  "title": "Mitt Projekt",
  "year": 2026,
  "poster": "/vault-art/mitt-projekt-card.jpg",
  "backdrop": "/vault-art/mitt-projekt-backdrop.jpg",
  "portrait": "/vault-art/mitt-projekt-portrait.jpg",
  "synopsis": "En kort beskrivning av vad filmen handlar om.",
  "genres": ["Kortfilm", "Komedi"],
  "duration": 300,
  "video": "/videos/mitt-projekt/mitt-projekt.mp4"
}
```

4. Committa och pusha. Vercel bygger om automatiskt och videon dyker upp på `/vault`.

## Lägg till en serie (flera avsnitt)

Samma sak, men lägg flera mp4-filer i mappen och beskriv varje avsnitt separat:

```json
{
  "slug": "min-serie",
  "type": "series",
  "title": "Min Serie",
  "year": 2026,
  "poster": "/vault-art/min-serie-card.jpg",
  "backdrop": "/vault-art/min-serie-backdrop.jpg",
  "synopsis": "En kort beskrivning av serien.",
  "genres": ["Kortfilm", "Spänning"],
  "episodes": [
    { "title": "Avsnitt 1", "episode": 1, "duration": 300, "poster": "/vault-art/min-serie-ep1.jpg", "video": "/videos/min-serie/01.mp4" },
    { "title": "Avsnitt 2", "episode": 2, "duration": 280, "poster": "/vault-art/min-serie-ep2.jpg", "video": "/videos/min-serie/02.mp4",
      "synopsis": "Vad som händer i just det här avsnittet.",
      "intro": { "start": 0, "end": 12 }, "credits": 262 }
  ]
}
```

## Fältreferens

| Fält | Gäller | Beskrivning |
|---|---|---|
| `slug` | alla | Unikt, kebab-case. Används i URL (`/vault/<slug>`), mapp-namn och för att komma ihåg var man var. |
| `type` | alla | `"movie"` eller `"series"`. |
| `title` | alla | Visningsnamn. Skrivs ut ovanpå korten, så bilderna ska **inte** ha titeln inbränd. |
| `year` | alla | Årtal. Raden "Nytt i valvet" sorteras på det. |
| `poster` | alla, avsnitt | 16:9-bild för korten i raderna (640×360). På ett avsnitt: avsnittets miniatyr. |
| `backdrop` | film/serie | Bred 16:9-bild för hero-bannern och info-rutan (1600×900). Saknas den används `poster`. |
| `portrait` | film/serie | Stående 2:3-bild (400×600) för topplistan. Saknas den används `poster`. |
| `synopsis` | alla, avsnitt | Kort beskrivning. På avsnitt visas den i avsnittslistan. |
| `genres` | film/serie | Lista med genrer. En genre som samlar minst två (men inte alla) titlar får en egen rad. Används också i sök och "Mer som detta". |
| `duration` | film/avsnitt | Längd i sekunder (visas som "5 min"). |
| `video` | film/avsnitt | Sökväg till mp4-filen **med inledande `/`** (t.ex. `/videos/mitt-projekt/mitt-projekt.mp4`). Utan `/` i början letar sidan på fel ställe när den öppnas via `/vault/<slug>`. |
| `featured` | film/serie | `true` = kan visas i hero-bannern. Flera titlar får ha det — då slumpas en per besök. Saknas det helt visas första titeln. |
| `top` | film/serie | Plats i raden "Topp N i valvet" (1, 2, 3…). Raden visas när minst tre titlar har `top`. |
| `trailer` | film/serie | Valfri kort mp4 som spelas upp tyst i hero-bannern efter ett par sekunder (med ljudknapp). |
| `intro` | film/avsnitt | `{ "start": 0, "end": 12 }` i sekunder — visar knappen "Hoppa över intro" under det intervallet. |
| `credits` | avsnitt | Sekund där eftertexterna börjar. Då dyker "Nästa avsnitt" upp med nedräkning. Utan fältet visas den de sista 15 sekunderna. |
| `subtitles` | film/avsnitt | `[{ "src": "/videos/mitt-projekt/sv.vtt", "lang": "sv", "label": "Svenska" }]` — WebVTT-filer, väljs i spelarens meny. |
| `cast` | film/serie | Valfri lista med namn ("Medverkande"). |
| `director` | film/serie | Valfritt namn (eller lista) för "Regi". |
| `episodes` | serie | Lista med avsnitt, se exemplet ovan. Sorteras på `episode`. |

Under `"titles"` ligger bara riktiga film/serie-projekt — livesändningar hör hemma under `"lives"`.

## Lägg till en livesändning

Klistra in YouTube-länken under `"lives"` i `manifest.json`. Det räcker — tumnageln hämtas från
YouTube, och titeln slås upp automatiskt i besökarens webbläsare (via oEmbed, sparas en vecka).
Vill du bestämma titeln själv, eller om uppslaget inte fungerar, skriv in `title`:

```json
"lives": [
  { "youtube": "https://www.youtube.com/watch?v=6Y8ciHSL7dI" },
  {
    "youtube": "https://www.youtube.com/watch?v=XXXXXXXXXXX",
    "title": "Skolans vårkonsert 2026",
    "date": "2026-05-28",
    "category": "Event",
    "duration": 5400,
    "description": "Tre kameror, klippt live."
  }
]
```

| Fält | Beskrivning |
|---|---|
| `youtube` | Länken eller bara video-ID:t. En `t=` i länken ignoreras — använd `start` om sändningen ska börja en bit in. |
| `title` | Valfri. Utan den hämtas YouTube-titeln automatiskt (visas som "Livesändning" tills den är hämtad). |
| `date` | `ÅÅÅÅ-MM-DD`. Finns datum sorteras biblioteket nyast först, annars i manifestets ordning. |
| `category` | T.ex. `"Sport"`, `"Event"`, `"Konsert"`. När det finns minst två kategorier dyker filterknappar upp. |
| `duration` | Längd i sekunder (visas som tidskod på kortet). |
| `description` | Visas under spelaren. |
| `start` | Sekund att börja på. |
| `thumbnail` | Egen bild istället för YouTubes tumnagel. |
| `channel` | Kanalnamn att visa (annars YouTubes). |

Sändningen måste tillåta inbäddning på YouTube; annars visar spelaren ett fel och "Öppna på YouTube"
fungerar fortfarande.

## Bilder

Vault använder komprimerade bilder i `vault-art/` istället för de stora originalen på sajten
(PNG-stillbilderna är 1–2 MB styck — för tungt för en sida med många kort). Gör så här för en ny titel:

- **Kort** (`*-card.jpg`): 640×360, JPG ~80 % kvalitet. Ingen text i bilden.
- **Backdrop** (`*-backdrop.jpg`): 1600×900. Välj en bild där vänstra delen är lugn — titeln och
  knapparna ligger där.
- **Porträtt** (`*-portrait.jpg`): 400×600, beskuren kring huvudpersonen.
- Har stillbilden svarta letterbox-kanter: beskär bort dem först.

## Spelaren

- Kommer ihåg var man var (per film/avsnitt), volym och val av undertexter — i webbläsaren (localStorage).
- Tangentbord: mellanslag/K = paus, ←/→ = ±10 s, ↑/↓ = volym, M = ljud av/på, F = helskärm,
  N = nästa avsnitt, S = hoppa över intro, Esc = stäng meny.
- Mobil: tryck för att visa/dölja kontrollerna, dubbeltryck på vänster/höger sida för ±10 s.
- Länka till en viss tid med `?t=` i sekunder, t.ex. `/vault/jonathan?ep=2&t=90`.
- Länka direkt till en titels info-ruta: `/vault?titel=<slug>`, eller en sändning: `/vault?visa=live&live=<youtube-id>`.

## Just nu

Alla titlar i manifestet pekar tillfälligt på samma placeholder-klipp (`videos/ident.mp4`) tills de
riktiga klippen finns klara. Byt bara ut `video`-sökvägen (eller `episodes[].video`) per titel när
en riktig fil är redo — resten av posten kan stå kvar som den är. Filmerna saknar `duration` tills
de riktiga längderna är kända.

Genrerna är ifyllda utifrån beskrivningarna (Jonathan = "Spänning", Noomaraton-bidragen =
"Noomaraton") — justera fritt.

## Kända begränsningar

- **Manifestet är sanningen.** Att bara droppa en mp4-fil i `videos/`-mappen gör ingenting förrän
  den också finns med i `manifest.json`.
- **Ingen Git LFS är påkopplat.** Filmfiler du committar ligger kvar i git-historiken för alltid,
  och GitHub stoppar hårt vid 100 MB per fil. Håll klippen korta/komprimerade tills vidare.
- **"Inte länkad" är inte samma sak som privat.** Det finns ingen inloggning — vem som helst med
  `/vault`-länken ser allt som står i manifestet, och kan ladda ner videofilerna direkt.
- **Inga konton.** "Fortsätt titta" och "Min lista" sparas per webbläsare och följer inte med
  mellan enheter.
