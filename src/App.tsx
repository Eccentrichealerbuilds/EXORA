import { ToastHost } from "./notifications/ToastHost";
import { Routes, Route } from 'react-router';
import Home from './pages/Home.tsx'
import LaunchScreen from "./pages/LaunchScreen.tsx";
import Trading from "./pages/Trading.tsx";
import { RequireSession } from "./components/RequireSession";
import { TradingSetupProvider } from "./components/TradingSetup";

export default function App() {
      return (
            <>
            <ToastHost />
            <Routes>
                  <Route path="/" element={<LaunchScreen/>}/>
                  <Route element={<RequireSession />}>
                  <Route element={<TradingSetupProvider />}>
                  <Route path="/home" element={<Home />} />
                  <Route path="/trade" element={<Trading />} />
                  <Route path="/portfolio" element={<Trading />} />
                  <Route path="/activity" element={<Trading />} />
                  </Route>
                  </Route>
            </Routes>
            </>
      )
}
