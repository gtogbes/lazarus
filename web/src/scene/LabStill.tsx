/**
 * The still that stands in for the 3D scene (Requirement 7.4). It follows the
 * proof status like the scene does; status itself is announced elsewhere, so
 * the image is decorative (`alt=""`, inside the slot's aria-hidden wrapper).
 * The stills are 3:1, so a portrait phone shows only a slice of their middle (about 15% at 390 x 844).
 */
import { useProofRun } from '../features/proof/useProofRun';
import { moodForStatus } from './sceneLook';
import { STILL_HEIGHT, STILL_WIDTH, stillForMood, stillUrls } from './stills';

export function LabStill() {
  const mood = useProofRun((s) => moodForStatus(s.status));
  const { name, filter } = stillForMood(mood);
  const urls = stillUrls(name);
  return (
    // Fills the full-viewport layer and crops to cover; centred on the slab.
    <picture className="block h-full w-full">
      <source type="image/avif" srcSet={urls.avif} />
      <img
        src={urls.webp}
        alt=""
        width={STILL_WIDTH}
        height={STILL_HEIGHT}
        loading="lazy"
        decoding="async"
        data-testid="lab-still"
        data-mood={mood}
        className="h-full w-full object-cover"
        style={filter === undefined ? undefined : { filter }}
      />
    </picture>
  );
}
