import React from 'react';
import {BrowserRouter, Routes, Route, Navigate} from 'react-router-dom';
import Login from './login/Login';
import Dashboard from './dashboard/Dashboard';
import Profile from './profile/Profile';
import Projects from './projects/Projects';
import LetterDrafts from './letter drafts/LetterDrafts';
import MainLayout from './layout/MainLayout';
import {ProjectProvider} from './context/ProjectContext';
import '@frontend/src/index.css';

export const App: React.FC = () => {
    return (
        <ProjectProvider>
            <BrowserRouter>
                <Routes>
                    <Route path="/" element={<Navigate to="/login" replace/>}/>
                    <Route path="/login" element={<Login/>}/>

                    {/* Persistent Layout: Left Sidebar + Top Header remain across all pages */}
                    <Route element={<MainLayout/>}>
                        <Route path="/dashboard" element={<Dashboard/>}/>
                        <Route path="/profile" element={<Profile/>}/>
                        <Route path="/projects" element={<Projects/>}/>
                        <Route path="/drafts" element={<LetterDrafts/>}/>
                    </Route>

                    <Route path="*" element={<Navigate to="/login" replace/>}/>
                </Routes>
            </BrowserRouter>
        </ProjectProvider>
    );
};

export default App;
