/**
 * Pilot tools are for local development or an explicitly configured pilot
 * build. Normal production builds expose only Today, Work and project settings.
 */
export const PILOT_ENABLED =
  import.meta.env.DEV || import.meta.env.VITE_ENABLE_PILOT === 'true'
