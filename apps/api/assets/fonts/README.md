# Invoice PDF fonts

Embedded in every invoice PDF (`src/routes/invoices/pdf/`), so Latin, Cyrillic and Georgian text look the same in any viewer.

| File                                                        | Family                             | Source                                     |
| ----------------------------------------------------------- | ---------------------------------- | ------------------------------------------ |
| `NotoSans-Regular.ttf`, `NotoSans-Bold.ttf`                 | Noto Sans (Latin, Greek, Cyrillic) | notofonts/latin-greek-cyrillic, hinted TTF |
| `NotoSansGeorgian-Regular.ttf`, `NotoSansGeorgian-Bold.ttf` | Noto Sans Georgian                 | notofonts/georgian, hinted TTF             |

Both families are under the SIL Open Font License 1.1 (`OFL.txt`). The files are unmodified copies from the Noto project's release tree.
