import { defineConfig, presetUno, presetIcons, presetTypography } from 'unocss';

export default defineConfig({
    presets: [
        presetUno(),
        presetIcons(),
        presetTypography(),
    ],
    theme: {
        colors: {
            bg: '#0f1115',
            fg: '#e6e6e6',
            muted: '#888',
            accent: '#58a6ff',
            border: '#2a2e35',
            card: '#161922',
            hover: '#1d2230',
        },
        fontFamily: {
            mono: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
        },
    },
});
