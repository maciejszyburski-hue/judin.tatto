# Judin.tattoo — Handoff dla nowej sesji
> Wklej ten plik na początku nowej sesji Claude Code.

---

## Projekt
**Klient:** Jan Judin — Studio Tatuażu Gdańsk
**Domena:** judin.tattoo
**Pliki:** `judin-tattoo/index.html` + `judin-tattoo/galeria.html`
**Stack:** HTML + CSS + vanilla JS, zero frameworków, zero build tool
**Lokalny serwer:** w folderze `judin-tattoo` uruchom: `npx serve -p 3000` → http://localhost:3000

---

## Aktualny stan — sesja 4 (2026-04-07)

### Sekcje index.html (w kolejności)
1. **Intro overlay** — UnifrakturMaguntia logo, clip-path needle reveal, "Kliknij aby wejść", logo do nav. Gra przy KAŻDYM odświeżeniu (brak sessionStorage skip).
2. **Nav** — UnifrakturMaguntia logo, linki, hamburger mobile, CTA "Pełna Galeria"
3. **Hero** — animowany SVG tatuaż (sztylet+węże+róże rysują się stroke-dasharray), stats bar, H1, CTA buttons, scroll hint
4. **Marquee** — style tatuaży z separatorem ✦
5. **About** — 3D tilt zdjęcie artysty + overlay foto + badge, skill bars animowane
6. **Gallery Strip** — poziomy drag-to-scroll pasek ze zdjęciami (6 szt.)
7. **Process** — 4 kroki z hover lift
8. **Pricing** — table z ikonami SVG, badge POPULARNY
9. **Booking** — vanilla JS calendar, time slots, form
10. **Contact** — 4 kolumny
11. **Footer**

### Design system
```css
:root {
  --ink:    #07060A;
  --dark:   #0f0d12;
  --panel:  #141218;
  --azure:  #4db8e8;   /* główny akcent — niebieski */
  --azure2: #72d2f7;
  --cream:  #ede8df;
  --muted:  #6b6470;
  --border: rgba(77,184,232,0.15);
}
```

### Fonty
- **UnifrakturMaguntia** — logo nav, hero H1, intro (gothic blackletter)
- **Cinzel** — section headings (occult/dark luxury)
- **Cormorant Garamond italic** — akcenty italic, hero-italic
- **Barlow / Barlow Condensed** — body text, labels

### Zaawansowane feature (wszystkie działają)
| Feature | Opis |
|---------|------|
| Custom cursor | dot + ring z lerp 0.12, hover expand, click shrink |
| Scroll progress | 2px azure linia u góry z glow |
| Intro SVG animation | clip-path reveal + needle sweep, buzz audio |
| Hero SVG tattoo | stroke-dasharray draw animation, 9 grup z stagger delay |
| Patchwork bg | `body::after` SVG tile z motywami tatuaży, opacity 0.028 |
| Grain overlay | `body::before` SVG noise, opacity 0.035 |
| 3D tilt photo | perspective rotateX/Y na about section |
| Magnetic buttons | `.magnetic` class, mousemove translate |
| Skill bars | animate on IntersectionObserver |
| Gallery drag | mousedown/mousemove + touch swipe |
| Web Audio API | buzz intro / click / hover / whoosh, mute button |
| Scroll reveals | reveal / reveal-left / reveal-right / reveal-scale + delay-1..6 |
| Counter anim | data-count → animuje do wartości |
| Booking calendar | vanilla JS, blocked dates/slots, form |
| Flash motifs bg | 8 SVG motywów generowanych JS w hero section |

### Audio (Web Audio API)
- Buzz intro: sawtooth+square+LFO, gain 0.55, 2.4s
- Click: sine sweep 800→200Hz, gain 0.7, 80ms
- Hover nav: sine 1200Hz, gain 0.25, 40ms
- Whoosh dismiss: noise sweep, gain 0.6, 500ms
- Mute button: fixed top-right, sessionStorage 'judinMute'

### galeria.html
- 18 zdjęć Unsplash + picsum fallback
- Masonry CSS columns:3
- Filter tabs: Wszystkie / Blackwork / Fine Line / Japanese / Geometric / Neo Traditional
- Lightbox: keyboard (← → Esc) + touch swipe + counter X/18
- Stagger reveal 60ms per item

---

## Dane klienta (z Booksy)
```
Nazwa:     Judin Tattoo
Artysta:   Jan Judin
Adres:     Damroki 1 D, 80-177 Gdańsk
Tel:       +48 780 792 172
Godziny:   Pon–Nd 10:00–19:00
Rating:    5.0★ (34 opinie)
```

---

## Co DZIAŁA ✅
- Cały index.html i galeria.html renderują się poprawnie
- Intro animacja przy każdym odświeżeniu
- Audio (buzz, click, hover, whoosh)
- Custom cursor + scroll bar
- Magnetic buttons + 3D tilt
- Patchwork SVG tło
- Hero SVG drawing animation
- Gallery strip drag + galeria.html lightbox z filterami
- SEO: Schema.org TattooParlor + Open Graph + meta

## TODO / Braki ❌
- **Backend booking** — calendar jest frontend-only, nie zapisuje rezerwacji
- **Realne zdjęcia** — wszystkie Unsplash; Jan Judin ma prace na IG/Booksy
- **Logo SVG** — używamy tekst UnifrakturMaguntia; brak prawdziwego logo
- **404 strona** — nie istnieje
- **Deploy** — strona nie jest opublikowana (Netlify/Vercel drag & drop)

---

## Następne kroki (sugerowane)
1. **Deploy na Netlify** — przeciągnij folder `judin-tattoo` na netlify.com/drop → gotowy link dla klienta
2. **Realne zdjęcia** — poproś Jana o zdjęcia z IG, podmień Unsplash IDs
3. **Backend booking** — Netlify Forms lub Formspree dla formularza
4. **Logo SVG** — użyj `mcp__21st-magic__logo_search` lub narysuj własne

---

## Jak zacząć nową sesję
```
Kontynuuję projekt Judin.tattoo — studio tatuażu Gdańsk.
Plik: C:\Users\macie\OneDrive\Desktop\claude code\judin-tattoo\index.html
Wklejam HANDOFF.md:
[wklej zawartość tego pliku]
```
