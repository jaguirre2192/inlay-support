#!/usr/bin/env python3
"""Build Inlay's static marketing pages. The proof studio has its own source."""
from pathlib import Path
from html import escape

ROOT = Path(__file__).resolve().parents[1]
ART = '/assets/collection/'
ARROW = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6"/></svg>'
MENU = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h16M4 16h16"/></svg>'
ED = {
    'your-world': dict(name='Your World', file='world', line='Every place, together.',
        description='A lifetime of places, together in one illustrated atlas. Your countries, a personal dedication and a little row of flags, each one a memory.',
        alt='Your World sample: an illustrated world map, 24 complete country flags, Made for Jorge and a 24-country count.',
        sample='Sample atlas · 24 countries · Made for Jorge',
        features=['Your visited countries in their own illustrated art', 'A dedication, your country count and complete country flags', 'Your own atlas, a friend’s shared atlas, or two atlases as Our World']),
    'country': dict(name='Country', file='country', line='One place. An entire world.',
        description='A place that stays with you, captured in its own illustrated landscape. Familiar coastlines, small discoveries and the quiet pleasure of remembering.',
        alt='Country edition sample: illustrated Italy on a warm paper ground, with Italia lettering beside its coastline.',
        sample='Country edition · Italy shown',
        features=['One country, with its own illustration and lettering', 'Any country in the studio’s artwork collection', 'A quiet composition that gives the coastline room to breathe']),
    'memory': dict(name='Memory', file='memory', line='The place, and your part in it.',
        description='The country you remember, with the moments only you could have taken. Photographs you choose find their place around the illustration, held in little paper mounts.',
        alt='Memory edition sample: illustrated Italy with three mounted sample photographs of Florence and Rome.',
        sample='Memory edition · Italy · sample photographs',
        features=['An illustrated country and your selected photographs', 'Personal captions, a name and a dedication', 'Photo selection stays on your device; atlas links contain no photographs'])
}

def link(url, label, cls='text-link'):
    return f'<a class="{cls}" href="{url}">{label} {ARROW}</a>'

def framed(key, eager=False):
    p = ED[key]
    width, height = (3600, 2400) if key == 'your-world' else (2400, 3200)
    # Exact approved raster compositions, not a second mock configurator.
    return f'''<div class="print-frame"><img src="{ART}products/{p['file']}.png" width="{width}" height="{height}" alt="{escape(p['alt'])}" {'fetchpriority="high"' if eager else 'loading="lazy"'} decoding="async"></div>'''

def header(home=False, active=''):
    items = [('/editions/', 'The collection', 'editions'), ('/gifts/', 'Gifts', 'gifts'), ('/#story', 'Our story', ''), ('/#the-atlas', 'The atlas', '')]
    nav = ''.join('<a href="{}" {}>{}</a>'.format(url, 'aria-current="page"' if id and active == id else '', name) for url,name,id in items)
    return f'''<a class="skip" href="#main">Skip to content</a>
<header class="site-header {'home-header' if home else ''}">
  <a class="wordmark" href="/" aria-label="Inlay home">INLAY</a>
  <nav class="main-nav" aria-label="Main navigation">{nav}</nav>
  <details class="mobile-menu"><summary aria-label="Menu">{MENU}<span class="visually-hidden">Menu</span></summary><nav aria-label="Mobile navigation">{nav}<a href="/support/">Support</a></nav></details>
  <a class="studio-link" href="/print/">Print studio {ARROW}</a>
</header>'''

def footer():
    return '''<footer class="site-footer"><div class="footer-top">
<div><a class="footer-brand" href="/">Inlay</a><p>Every place, a part of you.<br>Illustrated memories, made personal.</p></div>
<nav aria-label="Editions"><a href="/editions/your-world/">Your World</a><a href="/editions/country/">Country</a><a href="/editions/memory/">Memory</a><a href="/gifts/">Gifts &amp; Our World</a></nav>
<nav aria-label="Information"><a href="/#the-atlas">The free atlas</a><a href="/print/">Print studio</a><a href="/support/">Support</a><a href="/privacy/">Privacy</a></nav>
</div><div class="footer-bottom"><p>© 2026 Inlay. A collection of places worth keeping.</p><p>Digital proofs are available with an Inlay atlas. Physical prints are coming later. Artwork examples use sample travel history and photographs; frames are illustrative.</p></div></footer>'''

def faq(q, a):
    return f'<details><summary>{q}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M12 5v14"/></svg></summary><div class="faq-answer">{a}</div></details>'

def card(key, level=3):
    p=ED[key]
    return f'''<a class="edition-link" href="/editions/{key}/"><figure><div class="art-stage {'world-stage' if key == 'your-world' else 'portrait-stage' if key == 'country' else 'memory-stage'}">{framed(key)}</div><figcaption><h{level}>{p['name']}</h{level}><p>{p['line']}</p><span class="edition-action">Explore the edition {ARROW}</span></figcaption></figure></a>'''

def handoff():
    return f'''<section class="process shell" id="make-a-proof"><div class="process-copy"><h2>Your atlas.<br>Your proof.</h2><p>Already have Inlay? Bring your places into the studio and make something personal.</p><p class="availability">Inlay is coming soon to iPhone. The app will be free.</p></div><ol class="process-list"><li><h3>Begin in Inlay</h3><p>Open the print option for your atlas, a friend’s shared atlas, or a comparison. Check the people and places, then continue to the print shop.</p></li><li><h3>Make it personal</h3><p>Choose Your World, Country or Memory in the studio. Edit the names and dedication, or add photographs from your device.</p></li><li><h3>Keep your composition</h3><p>Download a PNG proof or save your design to return to later. Physical printing and ordering will follow.</p></li></ol></section><div class="studio-invitation shell">{link('/print/', 'Open the print studio', 'button')}<p>Use a print link from Inlay or a saved design. Your atlas and selected photos stay in your browser.</p></div>'''

def app_showcase():
    # The native writer confirmed the old app captures must not be published.
    # Use approved, bundled atlas illustration until a fresh clean capture set is ready.
    return f'''<section class="app-showcase" id="the-atlas" aria-labelledby="atlas-heading"><div class="app-showcase-inner"><div class="app-showcase-copy"><h2 id="atlas-heading">Your world begins<br>in your pocket.</h2><p>Mark where you’ve been and watch each place come to life in its own illustration. Find the moments you took there. Compare the places you share with friends.</p><p class="app-free">The atlas is free.<br><span>The memories are yours.</span></p><p class="availability">Coming soon to iPhone.</p>{link('/#make-a-proof','From app to artwork')}</div><figure class="atlas-illustration"><img src="/print/assets/art/approved-italy.png" width="1440" height="1728" alt="Italy’s illustrated atlas artwork: Alpine peaks, Florence, Rome, lemon groves and the Mediterranean islands." loading="lazy" decoding="async"><figcaption>Italy, illustrated in Inlay.</figcaption></figure></div></section>'''

def home():
    return f'''{header(True)}<main id="main">
<section class="hero" aria-labelledby="hero-title"><div class="hero-scene"><figure class="hero-print">{framed('your-world',True)}</figure></div><div class="hero-copy shell"><h1 id="hero-title">Everywhere,<br>kept close.</h1><div class="hero-invitation"><p>A free illustrated atlas for your travels.<br>Personal artwork for the places that stay with you.</p>{link('/editions/','Explore the editions','button light')}{link('#the-atlas','Meet the free atlas','hero-app-link')}</div></div><p class="hero-credit">Your World · sample atlas &amp; dedication</p></section>
{app_showcase()}
<section class="intro shell"><h2>A journey doesn’t end<br>when you come home.</h2><p>Some places become part of who you are. Inlay brings them into view through illustrated landscapes, chosen photographs and a map that tells your own story.</p></section>
<section class="shell" aria-label="The three print editions"><article class="collection-feature"><a href="/editions/your-world/" class="edition-link" aria-label="Explore Your World"><div class="art-stage world-stage">{framed('your-world')}</div></a><div class="edition-copy"><h2>Your World</h2><p>{ED['your-world']['description']}</p>{link('/editions/your-world/','Explore Your World')}</div></article><div class="editions-duo">{card('country')}{card('memory')}</div></section>
<section class="gift-bridge shell"><h2>A world worth giving.</h2><p>A friend’s atlas, or two worlds brought together.</p>{link('/gifts/','Explore gifts &amp; Our World')}</section>
<section class="cinema" id="story" aria-labelledby="story-title"><img class="cinema-poster" src="{ART}atlas-film-poster.png" width="1920" height="1080" loading="lazy" alt="" aria-hidden="true"><video id="atlas-film" muted loop playsinline preload="none" aria-hidden="true" tabindex="-1" data-src="{ART}atlas-film.mp4"></video><div class="cinema-caption"><h2 id="story-title">A place is more<br>than a pin.</h2><p>The turn of a coastline. The colour of a hillside. A city you could find your way through with your eyes closed. Every illustration holds a little of what makes a place itself.</p><button class="motion-toggle" type="button" hidden>Play atmosphere<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7V5Z"/></svg></button><p class="motion-status" role="status"></p></div></section>
{handoff()}
<section class="faq shell" id="questions"><h2>A few things<br>you might wonder.</h2><div>
{faq('Can I use my actual Inlay map?', '<p>Yes. Open a print link from Inlay to bring your atlas into the studio. You can also open a saved design. The examples on these collection pages use sample travel history.</p>')}
{faq('Can I use my own photographs?', '<p>Yes. Choose Memory in the studio, then select photographs from your device and add captions. Your photos stay in your browser and are included only in the files you choose to export.</p>')}
{faq('Can I make something for a friend?', '<p>Use an atlas your friend has shared with you. For Our World, combine two atlases and keep the individual, shared and combined counts. It works for any two people.</p>')}
{faq('Can I order a physical print?', '<p>For now, you can create and download a digital proof. Paper, physical sizes, frames, prices and delivery will be confirmed before ordering opens. The frames shown here are illustrative.</p>')}
{faq('Is Inlay available on the App Store?', '<p>Inlay is coming soon to iPhone. The app will be free; physical prints will be optional.</p>')}
</div></section></main>{footer()}'''

def collection():
    return f'''{header(active='editions')}<main id="main" class="page-main shell"><div class="page-heading"><h1>Your travels,<br>in three editions.</h1><p>A place. A memory. Your whole world.<br>Choose the way you’d like to keep it.</p></div><p class="collection-note">Explore the collection, then personalize your actual atlas in the print studio. Digital proofs now; physical prints later.</p><div class="catalogue">{''.join(card(k,2) for k in ED)}</div></main>{footer()}'''

def product(key):
    p=ED[key]
    features=''.join(f'<li>{escape(x)}</li>' for x in p['features'])
    special = link('/gifts/','Made for someone else?') if key=='your-world' else ''
    return f'''{header(active='editions')}<main id="main" class="page-main"><div class="shell"><nav class="breadcrumbs" aria-label="Breadcrumb"><a href="/editions/">The collection</a><span aria-hidden="true">/</span><span aria-current="page">{p['name']}</span></nav><div class="product-grid"><figure class="product-visual"><div class="preview-stage" data-kind="{key}">{framed(key,True)}</div><figcaption>{p['sample']}. Frame illustrative.</figcaption></figure><div class="product-panel"><h1>{p['name']}</h1><p class="product-tagline">{p['line']}</p><p>{p['description']}</p><ul class="edition-features">{features}</ul>{link('/print/','Open the print studio','button')}<p class="proof-note">Start with a print link from Inlay or a saved design, then choose {p['name']}. Digital proof only; ordering opens later.</p>{special}<div class="product-details">{faq('How do I bring my atlas?', '<p>In Inlay, open the print option for your atlas, a friend or a comparison and continue to the print shop. The link brings the people and country lists into the studio. You can also paste that link in the studio.</p>')}{faq('What can I download?', '<p>A PNG proof of your composition and a saved design you can reopen. Physical sizes, materials and production will be confirmed before printed editions go on sale.</p>')}</div></div></div></div><section class="product-other shell"><h2>Another way to keep it.</h2><div class="other-links">{''.join(card(k) for k in ED if k!=key)}</div></section></main>{footer()}'''

def gifts():
    return f'''{header(active='gifts')}<main id="main" class="page-main shell"><div class="gift-intro"><h1>Their world.<br>Or yours, together.</h1><p>For the friend who’s been everywhere. For two people whose paths keep crossing. A personal atlas, made into something to keep.</p></div><section class="gift-feature" aria-labelledby="our-world-title"><figure class="gift-visual"><div class="gift-art"><div class="print-frame"><img src="{ART}products/our-world.png" width="1800" height="1200" alt="Our World sample for Sam and Alex: a 24-country combined atlas and complete flag row, with 18 and 16 individual countries and 10 visited by both." fetchpriority="high"></div></div><figcaption>Sample atlases · Sam 18 · Alex 16 · 10 both visited · 24 combined</figcaption></figure><div class="gift-copy"><h2 id="our-world-title">Our World</h2><p>Two people. One illustrated world. Bring together everywhere you’ve each been, with both names, your individual counts and the places your worlds have in common.</p><p>For friends, family, partners and travel companions.</p>{link('/print/','Open the print studio','button')}<p class="proof-note">Bring two atlases, then choose Our World in the studio. An overlap means you’ve both visited a place; it doesn’t assume you travelled there together.</p></div></section><section class="gift-friend"><div><h2>Give them<br>their whole world.</h2><p>A friend’s illustrated map, their country count, and a dedication with their name. Start with an atlas they’ve shared with you, then make it personal.</p>{link('/editions/your-world/','Explore Your World')}</div><div class="gift-friend-art">{framed('your-world')}</div></section><section class="gift-sharing"><h2>A thoughtful gift<br>starts with their atlas.</h2><div><p>In Inlay, choose a friend’s shared atlas or start from a comparison. Open the print link and review the map, names and dedication in the studio. You can add a second atlas there, too.</p><p>Photographs are never included in atlas links. Choose your own if you’d like to make a Memory edition.</p><p>Today you can download a personalized digital proof. Physical gift orders will follow.</p>{link('/editions/','Explore all three editions')}</div></section></main>{footer()}'''

def write(path,title,description,body,home=False):
    url='https://inlayatlas.com'+path
    doc=f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="{'#263526' if home else '#f5f0e4'}"><meta name="description" content="{escape(description)}"><meta name="referrer" content="strict-origin-when-cross-origin"><title>{escape(title)}</title><link rel="canonical" href="{url}"><meta property="og:type" content="website"><meta property="og:title" content="{escape(title)}"><meta property="og:description" content="{escape(description)}"><meta property="og:url" content="{url}"><meta property="og:image" content="https://inlayatlas.com/friend/card.png"><meta property="og:image:alt" content="Inlay illustrated atlas"><meta name="twitter:card" content="summary_large_image"><link rel="icon" type="image/svg+xml" href="/assets/collection/favicon.svg"><link rel="preload" as="font" type="font/ttf" crossorigin href="/print/assets/fonts/Italiana-Regular.ttf"><link rel="stylesheet" href="/collection.css"><script src="/collection.js" defer></script></head><body>{body}</body></html>'''
    dest=ROOT/path.lstrip('/')/'index.html'
    dest.parent.mkdir(parents=True,exist_ok=True)
    dest.write_text(doc+'\n')

write('/', 'Inlay — Everywhere, kept close.', 'A free illustrated atlas for iPhone, coming soon. Explore Country, Memory and Your World editions and make a personalized digital proof from your Inlay atlas.', home(), True)
write('/editions/', 'The collection — Inlay', 'Country, Memory and Your World: three ways to keep the places that stay with you. Explore the collection and create a personalized digital proof.', collection())
for key,p in ED.items():
    write(f'/editions/{key}/', p['name']+' — Inlay Editions', p['line']+' '+p['description'], product(key))
write('/gifts/', 'Gifts & Our World — Inlay', 'A friend’s atlas or two worlds brought together. Explore personalized digital proofs for friends, family and any two people.', gifts())
print('Built six static marketing pages. Proof studio, support, privacy and invitations unchanged.')
