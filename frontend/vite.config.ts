import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const aliases: Record<string, string> = {};

  if (mode === 'production') {
    // Keep realistic work-brief fixtures available for local design QA only.
    // A production bundle must never contain even representative internal work
    // items because its assets are publicly downloadable.
    aliases['./features/work-briefs/work-briefs.preview'] = fileURLToPath(
      new URL(
        './src/features/work-briefs/work-briefs.preview.production.ts',
        import.meta.url,
      ),
    );
  }

  return {
    plugins: [react()],
    resolve: { alias: aliases },
  };
})
