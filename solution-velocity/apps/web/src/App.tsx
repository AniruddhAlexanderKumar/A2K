import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { StoreProvider, useStore } from './lib/store';
import { AppShell } from './components/AppShell';
import { JourneyPage } from './pages/JourneyPage';
import { AssistantPage } from './pages/AssistantPage';
import { StudioPage } from './pages/StudioPage';
import { AuthPage } from './pages/AuthPage';
import { Skeleton } from './components/ui';

function Gate() {
  const { user, loadingSession } = useStore();

  if (loadingSession) {
    return (
      <main className="main">
        <Skeleton lines={3} />
      </main>
    );
  }

  if (!user) return <AuthPage />;

  return (
    <Routes>
      <Route element={<AppShell />}>
        {/* Exactly three primary destinations. Journey is the default landing page. */}
        <Route path="/journey" element={<JourneyPage />} />
        <Route path="/assistant" element={<AssistantPage />} />
        <Route path="/studio" element={<StudioPage />} />
        <Route path="*" element={<Navigate to="/journey" replace />} />
      </Route>
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <StoreProvider>
        <Gate />
      </StoreProvider>
    </BrowserRouter>
  );
}
