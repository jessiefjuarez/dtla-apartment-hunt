# DTLA Apartment Hunt

A tracker for the apartments we're touring in downtown LA. It sorts places into **Toured**, **To tour**, and **Looks nice**, ranks each list with a weighted score, and tracks rental applications.

## Features

- **Add by name or link.** Claude researches the building and estimates a score for each factor.
- **Tour questionnaire.** After a visit, your answers replace the estimates and move the place to Toured.
- **Weighted ranking.** Bedrooms, light, rent, block safety, living room, bathrooms, amenities, condition, commute, parking, pets, and any factors you add yourself.
- **Adjust priorities.** Rate how much each factor matters, and the weights are recalculated for you.
- **Work locations.** Add each roommate's office. The commute score averages everyone's trip.
- **Must-haves.** 3 bedrooms, 2+ bathrooms, pets allowed, parking, and in-unit washer/dryer. A place that's missing one sinks to the bottom of its list.
- **Applications tab.** Track status, fee, unit, next step, and follow-up dates.

## How saving works

The site is a Cloudflare Worker () that serves the page from  and keeps all apartments, weights, work locations and custom factors in one Durable Object. Every browser reads and writes that same store and checks for changes every 8 seconds, so it works like a shared, living workspace.

-  returns everything.  returns 204 if nothing changed.
-  /  saves or removes one apartment.
-  saves a setting.
-  fills the store the first time it runs.

**Passcode (recommended):** anyone with the link can edit until you add a secret named  in Cloudflare (Worker → Settings → Variables and secrets). After that, the page asks for the passcode once per browser.

## Files

-  is the page served by the Worker.
-  is the same page as published on Claude, where it uses Claude's storage and research instead.
-  is the Worker config. Pushing to  redeploys through Cloudflare Workers Builds.

## Live version

- https://dtla-apartment-hunt.jessiefjuarez.workers.dev/
- https://claude.ai/artifact/TfK88uFnQ3LE3CZAqSLrcz (Claude artifact version)
