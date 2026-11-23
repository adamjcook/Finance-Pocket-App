import { useEffect, useState } from 'preact/hooks';

function currentRoute(): string {
  return location.hash.replace(/^#/, '') || '/';
}

export function useRoute(): string {
  const [route, setRoute] = useState(currentRoute());
  useEffect(() => {
    const onChange = () => setRoute(currentRoute());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function navigate(route: string): void {
  location.hash = route;
}
