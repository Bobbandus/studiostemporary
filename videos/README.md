# A+ Vault — hur man lägger till en video

Vault är sidan `/vault` (inte länkad i huvudmenyn — bara den som har länken hittar den). Den läser
`videos/manifest.json` och listar/spelar allt som står där. Att bara lägga en mp4-fil i en mapp gör
ingenting av sig själv — filen måste också få en rad i `manifest.json`.

## Lägg till en film

1. Lägg mp4-filen här: `videos/mitt-projekt/mitt-projekt.mp4`
2. Lägg till en post under `"titles"` i `manifest.json`:

```json
{
  "slug": "mitt-projekt",
  "type": "movie",
  "title": "Mitt Projekt",
  "year": 2026,
  "poster": "/jonathan2-trailer.jpg",
  "synopsis": "En kort beskrivning av vad filmen handlar om.",
  "duration": 300,
  "video": "/videos/mitt-projekt/mitt-projekt.mp4"
}
```

3. Committa och pusha. Vercel bygger om automatiskt och videon dyker upp på `/vault`.

## Lägg till en serie (flera avsnitt)

Samma sak, men lägg flera mp4-filer i mappen och beskriv varje avsnitt separat:

```json
{
  "slug": "min-serie",
  "type": "series",
  "title": "Min Serie",
  "year": 2026,
  "poster": "/noomaraton2026-tiger.png",
  "synopsis": "En kort beskrivning av serien.",
  "episodes": [
    { "title": "Avsnitt 1", "episode": 1, "duration": 300, "video": "/videos/min-serie/01.mp4" },
    { "title": "Avsnitt 2", "episode": 2, "duration": 280, "video": "/videos/min-serie/02.mp4" }
  ]
}
```

## Fältreferens

| Fält | Gäller | Beskrivning |
|---|---|---|
| `slug` | alla | Unikt, kebab-case. Används i URL, mapp-namn och för att komma ihåg var man var. |
| `type` | alla | `"movie"` eller `"series"`. |
| `title` | alla | Visningsnamn. |
| `year` | alla | Årtal, valfritt men trevligt. |
| `poster` | alla | Bildväg **med inledande `/`** — antingen en befintlig bild på sajten (t.ex. `/noomaraton2026-tiger.png`) eller en ny bild du lägger i samma mapp som videon (t.ex. `/videos/mitt-projekt/poster.jpg`). |
| `synopsis` | alla | Kort beskrivning. |
| `duration` | film/avsnitt | Längd i sekunder. |
| `video` | film/avsnitt | Sökväg till mp4-filen **med inledande `/`** (t.ex. `/videos/mitt-projekt/mitt-projekt.mp4`). Utan `/` i början letar sidan på fel ställe när den öppnas via `/vault/<slug>`. |
| `featured` | film/serie | `true` på högst en titel — den blir hero-banner på `/vault`. Saknas det helt visas första titeln i listan istället. |
| `episodes` | serie | Lista med avsnitt, samma fält som en film fast utan `type`/`poster` (ärver posterbilden från serien, men kan sättas per avsnitt om ett avsnitt ska ha egen bild). |

Vault innehåller bara riktiga film/serie-projekt (inget om musik, spel eller livesändning) — håll det så.

## Just nu

Alla titlar i manifestet pekar tillfälligt på samma placeholder-klipp (`videos/ident.mp4`) tills de
riktiga klippen finns klara. Byt bara ut `video`-sökvägen (eller `episodes[].video`) per titel när
en riktig fil är redo — resten av posten kan stå kvar som den är.

## Kända begränsningar

- **Manifestet är sanningen.** Att bara droppa en mp4-fil i `videos/`-mappen gör ingenting förrän
  den också finns med i `manifest.json`.
- **Ingen Git LFS är påkopplat.** Filmfiler du committar ligger kvar i git-historiken för alltid,
  och GitHub stoppar hårt vid 100 MB per fil. Håll klippen korta/komprimerade tills vidare.
- **"Inte länkad" är inte samma sak som privat.** Det finns ingen inloggning — vem som helst med
  `/vault`-länken ser allt som står i manifestet, och kan ladda ner videofilerna direkt.
