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

## Files

- `artifact.html` is the source published as a Claude artifact. That version has shared storage and Claude research.
- `index.html` is the same page wrapped as a standalone HTML file. Opened on its own, it saves to your browser's local storage, and Claude research is turned off.

## Live version

https://claude.ai/artifact/TfK88uFnQ3LE3CZAqSLrcz (private; share it from the page's Share menu)
