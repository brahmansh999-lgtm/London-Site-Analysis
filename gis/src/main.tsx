import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { App } from './App';
import { PlanningWorkspaceRoute } from './components/PlanningWorkspace/PlanningWorkspaceRoute';
import { SvgOverlayRoute }        from './components/PlanningWorkspace/SvgOverlayRoute';
import { MassingViewerRoute }     from './components/Massing/MassingViewerRoute';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        {/* Step 1–3: Site selection, analysis, urban strategy */}
        <Route path="/"                element={<App />} />
        {/* Step 4: Procedural planning (dynamic grid) */}
        <Route path="/plan/:siteId"    element={<PlanningWorkspaceRoute />} />
        {/* Step 5: Detail plan overlay (SVG alignment) */}
        <Route path="/svg/:siteId"     element={<SvgOverlayRoute />} />
        {/* Steps 6–7: 3D abstract massing → componentised GLB assembly */}
        <Route path="/massing/:siteId" element={<MassingViewerRoute />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);