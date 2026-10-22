/*
 * This file is part of KiCad, a free EDA CAD application.
 * Copyright The KiCad Developers, see AUTHORS.txt for contributors.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

#pragma once

#include <future>
#include <vector>
#include <wx/panel.h>
#include <wx/timer.h>
#include <wx/treectrl.h>

class KICAD_MANAGER_FRAME;
class PROJECT_TREE_PANE;
class wxNotebook;
class wxSearchCtrl;
class wxStaticText;

/** Persistent project browser. Browsing never changes the active KIWAY project. */
class PROJECT_WORKSPACE : public wxPanel
{
public:
    PROJECT_WORKSPACE( KICAD_MANAGER_FRAME* aFrame, PROJECT_TREE_PANE* aDesignTree );
    ~PROJECT_WORKSPACE() override;

    bool AddDirectory( const wxString& aDirectory );
    void ShowAllProjects();
    void ProjectOpened();
    void ProjectClosed();
    void RefreshProjects();
    void UpdateLabels();

private:
    struct ENTRY
    {
        wxString file;
        wxString root;
    };

    struct SCAN_RESULT
    {
        std::vector<ENTRY> entries;
        bool limited = false;
    };

    static SCAN_RESULT Scan( const std::vector<wxString>& aDirectories );
    void rebuildTree();
    void saveDirectories();
    void onScanTimer( wxTimerEvent& aEvent );
    void onActivate( wxTreeEvent& aEvent );
    void onContextMenu( wxTreeEvent& aEvent );

    KICAD_MANAGER_FRAME* m_frame;
    wxNotebook* m_sections;
    wxPanel* m_allProjects;
    wxSearchCtrl* m_search;
    wxTreeCtrl* m_tree;
    wxStaticText* m_status;
    wxStaticText* m_designPath;
    wxStaticText* m_emptyDesign;
    PROJECT_TREE_PANE* m_designTree;
    wxTimer m_scanTimer;
    std::future<SCAN_RESULT> m_scan;
    std::vector<wxString> m_directories;
    std::vector<ENTRY> m_entries;
    bool m_scanAgain = false;
    bool m_limited = false;
};
