# Pixelize Design Document

## Next
Masterpiece is not a separate level. Drawing a level should work the same way: load a picture, flatten it to a 32-color palette, pixelize it, and play that grid. Do not keep a second "Masterpiece" mode beside the campaign.

## Visual Style
- Cartoonish, bright, playful. Soft outlines, vibrant colors.
- Workers: Cute characters with hard hats, overalls, different colors matching pixel colors. Simple animations (walk, jump, hammer).
- Pixels: Round dots or square pixels with slight bevel for depth.
- Forklifts: Tiny cartoon forklifts for loading workers into boxes.
- Font: Bold, outlined (e.g., using TextMeshPro with outline material) for "Pixelize" title.

## Main Menu Background Suggestion
A cheerful pixel factory scene: Giant pixel blocks being stacked or dismantled by a team of colorful cartoon workers. Some workers on forklifts, others with hammers. Soft gradient sky or workshop interior with windows showing pixel art. Playful lighting.

## Splash Screen
Full-screen cartoon worker (e.g., smiling worker holding a hammer or pixel block) as background. Centered "Pixelize" text, bold, with thick border/outline in contrasting color.

## Gameplay Flow
1. Player taps New Level → Splash screen (2-3s) while loading level data and instantiating grid.
2. Game screen loads: Grid in upper frame (40% height), 5 boxes below, 5 worker rows (4 visible each).
3. Tap worker → loads to empty box (forklift anim), shifts queue.
4. Tap box or auto-launch → worker jumps to grid, removes all matching edge pixels (hammer anims).
5. Repeat until grid empty.
6. Level complete → award points/coins, update progress bar. If progress maxed, award random bonus token.
7. Return to menu.

## Bonus Tokens
- Special Two Random Colored Worker: Spawns a worker that can clear two different colors or a dual-colored special.
- Extra Worker Box: Temporarily allows a 6th simultaneous worker or expands slots.
- Remove All of Color: Player selects a color (popup), clears every instance of it (even non-edges, for power).

## Monetization
- Green bill button opens shop: Coin packs via IAP (small, medium, large).
- Coins can buy extra tokens, continue, or cosmetics.
- Optional ads for free coins (not specified, but extensible).

## Technical Notes
- Use Canvas Scaler for mobile responsiveness.
- Object pooling for workers and pixel visuals.
- Edge detection via neighbor checks as implemented in PixelGrid.
- Persistence via PlayerPrefs (expand to cloud later).
- Levels as ScriptableObjects: grid size, color array, worker pool definition, reward points.

This foundation provides the core systems; UI layout, animations, art, and level data need to be built in the Unity Editor.
