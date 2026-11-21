import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './login/Login';
import Dashboard from './dashboard/Dashboard';
import Profile from './profile/Profile';
import Projects from './projects/Projects';
import LetterDrafts from './letter drafts/LetterDrafts';
import Summary from './summary/Summary';
import DailyReports from './reports/DailyReports';
import VoiceOrText from './voice or text capture/VoiceOrText';
import Analysis from './analysis/Analysis';
import MainLayout from './layout/MainLayout';
import { ProjectProvider } from './context/ProjectContext';
import { LanguageProvider } from './context/LanguageContext';
import '@frontend/src/index.css';

export const App: React.FC = () => {
  return (
    <LanguageProvider>
      <ProjectProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Navigate to="/login" replace />} />
            <Route path="/login" element={<Login />} />
          
          {/* Persistent Layout: Left Sidebar + Top Header remain across all pages */}
          <Route element={<MainLayout />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/reports" element={<DailyReports />} />
            <Route path="/capture" element={<VoiceOrText />} />
            <Route path="/analysis" element={<Analysis />} />
            <Route path="/alerts" element={<Analysis />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/drafts" element={<LetterDrafts />} />
            <Route path="/summary" element={<Summary />} />
          </Route>

          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    </ProjectProvider>
  </LanguageProvider>
  );
};

export default App;
