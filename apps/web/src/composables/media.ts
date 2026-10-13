import { onBeforeUnmount, ref, type Ref } from 'vue'

/** Narrow screens show the sidebar as an overlay (#132, #201). */
export const NARROW = '(max-width: 760px)'
/** A device with a mouse or trackpad, i.e. most likely a keyboard too (#201). */
export const FINE_POINTER = '(hover: hover) and (pointer: fine)'

/** Whether a media query matches, updated while the component is mounted. */
export function useMediaQuery(query: string, fallback = false): Ref<boolean> {
  const list = globalThis.matchMedia?.(query)
  const matches = ref(list ? list.matches : fallback)
  if (!list) return matches
  const update = (event: MediaQueryListEvent) => (matches.value = event.matches)
  list.addEventListener('change', update)
  onBeforeUnmount(() => list.removeEventListener('change', update))
  return matches
}
