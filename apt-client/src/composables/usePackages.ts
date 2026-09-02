import { ref, watch, type Ref } from 'vue';
import type { PackageEntry } from '../types';
import { fetchIndex } from '../api/packages';

export function usePackages(suite: Ref<string>, arch: Ref<string>) {
    const packages = ref<PackageEntry[]>([]);
    const loading = ref(false);
    const error = ref<Error | null>(null);

    async function load() {
        loading.value = true;
        error.value = null;
        try {
            packages.value = await fetchIndex(suite.value, arch.value);
        } catch (e) {
            error.value = e as Error;
        } finally {
            loading.value = false;
        }
    }

    watch([suite, arch], load, { immediate: true });

    return { packages, loading, error, reload: load };
}