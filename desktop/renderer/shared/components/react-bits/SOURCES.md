# React Bits source in Being Desktop

The TypeScript/CSS registry items below are the upstream artifacts. SHA-256 identifies the registry response used for comparison. The bundled [React Bits license](../react-bits-stack/LICENSE.md) covers these excerpts and components.

| Upstream registry | Local implementation | Adaptation |
| --- | --- | --- |
| [Stack-TS-CSS](https://reactbits.dev/r/Stack-TS-CSS) | [Stack.tsx](../react-bits-stack/Stack.tsx), [Stack.css](../react-bits-stack/Stack.css) | The CSS matches the registry. Stack uses the original motion for both directions of card navigation. [MessageImageGroup](../message-image-group.tsx) maps signed wheel gestures to the arrow keys, remembers the front photo, and suppresses the preview click after a drag. |
| [WarmTooltip-TS-CSS](https://reactbits.dev/r/WarmTooltip-TS-CSS) | [WarmTooltip.tsx](WarmTooltip.tsx), [WarmTooltip.css](WarmTooltip.css) | The CSS is preserved byte-for-byte. The TSX exports the existing group context and accepts a tooltip class on the portal so [DockTooltipGroup](../../../app/components/dock-tooltip.tsx) can use original motion on the normal and plugin DOM buttons. [ChatActionTooltip](../chat-action-tooltip.tsx) supplies the chat theme, Escape dismissal, reduced motion and first-tap behavior. |
| [GlideSelect-TS-CSS](https://reactbits.dev/r/GlideSelect-TS-CSS) | [GlideSelectMotion.ts](GlideSelectMotion.ts), [pill CSS](../../../chat/styles/_attachment-menu.scss) | The active-pill update is adapted from upstream. Being measures its variable-height rows and retains the glide independently of the panel motion. |
| [GradualBlur-TS-CSS](https://reactbits.dev/r/GradualBlur-TS-CSS) | [GradualBlur.tsx](GradualBlur.tsx), [GradualBlur.css](GradualBlur.css) | Registry files preserved byte-for-byte. Being sets layer count, strength, tint and the height of each chat edge through props. |
| [Folder-TS-CSS](https://reactbits.dev/r/Folder-TS-CSS) | [Folder.tsx](Folder.tsx), [Folder.css](Folder.css) | Registry files preserved byte-for-byte. The library supplies the grid, two untitled paper shapes, and the folder name beneath the component. |
| [TiltedCard-TS-CSS](https://reactbits.dev/r/TiltedCard-TS-CSS.json) | [TiltedCard.tsx](TiltedCard.tsx), [TiltedCard.css](TiltedCard.css) | Registry files preserved byte-for-byte. The library passes the file thumbnail, its dimensions, and the existing open action through the component props. |
| [StatusMark-TS-CSS](https://reactbits.dev/r/StatusMark-TS-CSS.json) | [StatusMark.tsx](status-mark/StatusMark.tsx), [StatusMark.css](status-mark/StatusMark.css) | Registry files preserved byte-for-byte. The animation uses the existing icon slot and theme colors in scene rows and tool activity rows. |

Registry SHA-256

- Stack — `05676dbf8bb16108930a80eabde4eb821c499feb2510c16b9fe6f30d10f603a3`
- WarmTooltip — `b70b7710e4c9092adc024c484c1847a4d9554d1d7ff1fd41239a8ed95a0063fe`
- GlideSelect — `3e68c56273c623ccfb21ac950721e56043fa96566be03006fb768b861d7b5ab2`
- Folder — `0cedc7c6b64bce62786ff1b1d291d97642008341229ce7daeae94c670590a678`
- TiltedCard — `cea045ff689cf634bdf8e5b7d9366a5b45db9e7b632e8bbaece07ed7a9a33695`
- GradualBlur — `b4bbe4ac5bde8f65003b29f345a62a53c53e66db7ba6568fc8eb60b4754a3673`

Image preview, image generation, Markdown mode selection, error details, the Prompt editor and the send queue use Being components.
