
## UI/UX pass (interface, colors, navigation, login)
- Added a real, visible **Back** button (`TopBar` component, top of every
  inner page) instead of relying on Chrome's browser-back button — in a
  single-page app, browser back can skip past form submissions or land
  somewhere unexpected. Every inner page now also has a "Dashboard" link
  next to it.
- Rebuilt the main dashboard (`App.jsx`) as an organized card grid with
  icons and short descriptions, grouped by role, instead of a stack of
  identical unlabeled buttons.
- Redesigned the login and register pages (centered card, clearer role
  picker as toggle buttons instead of a dropdown, consistent branding).
- Extended the existing color system (kept the classroom/chalkboard
  identity — cream "paper" + dark chalkboard green + chalk yellow —
  rather than replacing it) with a couple of supporting tones and
  consistent spacing so cards, tiles, and forms feel like one system
  instead of ad hoc pages.
