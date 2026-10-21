/*
 * This file is part of KiCad, a free EDA CAD application.
 * Copyright The KiCad Developers, see AUTHORS.txt for contributors.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

#include "project_workspace.h"
#include "kicad_manager_frame.h"
#include "project_tree_pane.h"

#include <algorithm>
#include <chrono>
#include <filesystem>
#include <bitmaps.h>
#include <bitmap_store.h>
#include <file_history.h>
#include <launch_ext.h>
#include <pgm_base.h>
#include <settings/kicad_settings.h>
#include <settings/settings_manager.h>
#include <tool/tool_manager.h>
#include <tools/kicad_manager_actions.h>
#include <wx/button.h>
#include <wx/filename.h>
#include <wx/imaglist.h>
#include <wx/menu.h>
#include <wx/notebook.h>
#include <wx/srchctrl.h>
#include <wx/stattext.h>
#include <wx/sizer.h>

namespace
{
class ITEM_DATA : public wxTreeItemData
{
public:
    ITEM_DATA( const wxString& aPath, bool aProject ) : path( aPath ), project( aProject ) {}
    wxString path;
    bool project;
};

bool samePath( const wxString& aLeft, const wxString& aRight )
{
    return wxFileName( aLeft ).SameAs( wxFileName( aRight ) );
}

wxString fromPath( const std::filesystem::path& aPath )
{
    const auto utf8 = aPath.u8string();
    return wxString::FromUTF8( reinterpret_cast<const char*>( utf8.c_str() ) );
}
}

PROJECT_WORKSPACE::PROJECT_WORKSPACE( KICAD_MANAGER_FRAME* aFrame,
                                      PROJECT_TREE_PANE* aDesignTree ) :
        wxPanel( aFrame ), m_frame( aFrame ), m_designTree( aDesignTree ), m_scanTimer( this )
{
    SetMinSize( FromDIP( wxSize( 260, 120 ) ) );
    auto* layout = new wxBoxSizer( wxVERTICAL );
    m_sections = new wxNotebook( this, wxID_ANY );
    m_allProjects = new wxPanel( m_sections );
    auto* allSizer = new wxBoxSizer( wxVERTICAL );
    auto* buttons = new wxBoxSizer( wxHORIZONTAL );
    auto* add = new wxButton( m_allProjects, wxID_ADD, _( "Add Project Folder..." ) );
    auto* refresh = new wxButton( m_allProjects, wxID_REFRESH, _( "Refresh" ),
                                  wxDefaultPosition, wxDefaultSize, wxBU_EXACTFIT );
    add->Bind( wxEVT_BUTTON, [this]( wxCommandEvent& )
    {
        m_frame->GetToolManager()->RunAction( KICAD_MANAGER_ACTIONS::browseProjectDirectory );
    } );
    refresh->Bind( wxEVT_BUTTON, [this]( wxCommandEvent& ) { RefreshProjects(); } );
    buttons->Add( add, 1, wxRIGHT, FromDIP( 4 ) );
    buttons->Add( refresh );
    allSizer->Add( buttons, 0, wxEXPAND | wxALL, FromDIP( 8 ) );
    m_search = new wxSearchCtrl( m_allProjects, wxID_ANY );
    m_search->SetDescriptiveText( _( "Search projects or paths" ) );
    m_search->ShowCancelButton( true );
    m_search->Bind( wxEVT_TEXT, [this]( wxCommandEvent& ) { rebuildTree(); } );
    allSizer->Add( m_search, 0, wxEXPAND | wxLEFT | wxRIGHT | wxBOTTOM, FromDIP( 8 ) );
    m_tree = new wxTreeCtrl( m_allProjects, wxID_ANY, wxDefaultPosition, wxDefaultSize,
                             wxTR_HAS_BUTTONS | wxTR_HIDE_ROOT | wxTR_SINGLE | wxTR_NO_LINES );
    m_tree->SetName( _( "All Projects" ) );
    auto* images = new wxImageList( FromDIP( 18 ), FromDIP( 18 ), true );
    images->Add( KiBitmapBundle( BITMAPS::directory ).GetBitmap( FromDIP( wxSize( 18, 18 ) ) ) );
    images->Add( KiBitmapBundle( BITMAPS::project_kicad ).GetBitmap( FromDIP( wxSize( 18, 18 ) ) ) );
    m_tree->AssignImageList( images );
    m_tree->Bind( wxEVT_TREE_ITEM_ACTIVATED, &PROJECT_WORKSPACE::onActivate, this );
    m_tree->Bind( wxEVT_TREE_ITEM_RIGHT_CLICK, &PROJECT_WORKSPACE::onContextMenu, this );
    allSizer->Add( m_tree, 1, wxEXPAND );
    m_status = new wxStaticText( m_allProjects, wxID_ANY, wxEmptyString );
    allSizer->Add( m_status, 0, wxEXPAND | wxALL, FromDIP( 8 ) );
    m_allProjects->SetSizer( allSizer );
    m_sections->AddPage( m_allProjects, _( "All Projects" ), true );

    auto* design = new wxPanel( m_sections );
    auto* designSizer = new wxBoxSizer( wxVERTICAL );
    m_designPath = new wxStaticText( design, wxID_ANY, wxEmptyString, wxDefaultPosition,
                                    wxDefaultSize, wxST_ELLIPSIZE_MIDDLE );
    designSizer->Add( m_designPath, 0, wxEXPAND | wxALL, FromDIP( 8 ) );
    m_emptyDesign = new wxStaticText( design, wxID_ANY,
                                      _( "Open a project from All Projects to see its design files." ) );
    m_emptyDesign->Wrap( FromDIP( 230 ) );
    designSizer->Add( m_emptyDesign, 0, wxEXPAND | wxALL, FromDIP( 12 ) );
    m_designTree->Reparent( design );
    designSizer->Add( m_designTree, 1, wxEXPAND );
    design->SetSizer( designSizer );
    m_sections->AddPage( design, _( "Project Design" ) );
    layout->Add( m_sections, 1, wxEXPAND );
    SetSizer( layout );

    m_directories = Pgm().GetSettingsManager().GetAppSettings<KICAD_SETTINGS>( "kicad" )->m_ProjectDirectories;
    Bind( wxEVT_TIMER, &PROJECT_WORKSPACE::onScanTimer, this, m_scanTimer.GetId() );
    ProjectClosed();
    RefreshProjects();
}

PROJECT_WORKSPACE::~PROJECT_WORKSPACE()
{
    m_scanTimer.Stop();
    // The worker owns snapshots only; it never calls back into a destroyed window.
    if( m_scan.valid() )
        m_scan.wait();
}

PROJECT_WORKSPACE::SCAN_RESULT PROJECT_WORKSPACE::Scan( const std::vector<wxString>& aDirectories )
{
    namespace fs = std::filesystem;
    SCAN_RESULT result;
    size_t visited = 0;
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds( 5 );

    for( const wxString& root : aDirectories )
    {
        std::error_code error;
        const auto rootUtf8 = root.utf8_str();
        const fs::path rootPath( reinterpret_cast<const char8_t*>( rootUtf8.data() ) );
        fs::recursive_directory_iterator it( rootPath,
                fs::directory_options::skip_permission_denied, error ), end;

        while( it != end && !error )
        {
            if( ++visited > 100000 || std::chrono::steady_clock::now() > deadline )
            {
                result.limited = true;
                break;
            }

            const auto& entry = *it;
            wxString name = fromPath( entry.path().filename() );

            if( entry.is_directory( error ) )
            {
                if( it.depth() >= 8 || name.StartsWith( "." ) || name.EndsWith( "-backups" )
                    || name == "node_modules" || name == "build" )
                    it.disable_recursion_pending();
            }
            else if( entry.is_regular_file( error ) )
            {
                wxString ext = fromPath( entry.path().extension() ).Lower();

                if( ext == ".kicad_pro" || ext == ".pro" )
                {
                    // Prefer the current project format when both versions exist.
                    auto modern = entry.path();
                    modern.replace_extension( ".kicad_pro" );
                    if( ext != ".pro" || !fs::exists( modern, error ) )
                        result.entries.push_back( { fromPath( entry.path() ), root } );
                }
            }

            error.clear();
            it.increment( error );
        }

        if( result.limited )
            break;
    }

    std::sort( result.entries.begin(), result.entries.end(),
               []( const ENTRY& a, const ENTRY& b ) { return a.file.CmpNoCase( b.file ) < 0; } );
    return result;
}

void PROJECT_WORKSPACE::RefreshProjects()
{
    if( m_scan.valid() )
    {
        m_scanAgain = true;
        return;
    }

    m_status->SetLabel( _( "Scanning project folders..." ) );
    m_scan = std::async( std::launch::async, &PROJECT_WORKSPACE::Scan, m_directories );
    m_scanTimer.Start( 100 );
}

void PROJECT_WORKSPACE::onScanTimer( wxTimerEvent& )
{
    if( !m_scan.valid()
        || m_scan.wait_for( std::chrono::seconds( 0 ) ) != std::future_status::ready )
        return;

    SCAN_RESULT result = m_scan.get();
    m_scanTimer.Stop();
    m_entries = std::move( result.entries );
    m_limited = result.limited;

    if( m_scanAgain )
    {
        m_scanAgain = false;
        RefreshProjects();
    }
    else
    {
        rebuildTree();
    }
}

void PROJECT_WORKSPACE::saveDirectories()
{
    auto* settings = Pgm().GetSettingsManager().GetAppSettings<KICAD_SETTINGS>( "kicad" );
    settings->m_ProjectDirectories = m_directories;
    settings->SaveToFile( Pgm().GetSettingsManager().GetPathForSettingsFile( settings ) );
}

bool PROJECT_WORKSPACE::AddDirectory( const wxString& aDirectory )
{
    wxFileName path = wxFileName::DirName( aDirectory );
    if( !path.DirExists() )
        return false;
    path.Normalize( wxPATH_NORM_DOTS | wxPATH_NORM_ABSOLUTE );

    const wxString directory = path.GetPath();
    if( std::none_of( m_directories.begin(), m_directories.end(),
                     [&]( const wxString& old ) { return samePath( old, directory ); } ) )
    {
        m_directories.push_back( directory );
        saveDirectories();
    }
    ShowAllProjects();
    RefreshProjects();
    return true;
}

void PROJECT_WORKSPACE::ShowAllProjects()
{
    m_sections->SetSelection( 0 );
}

void PROJECT_WORKSPACE::ProjectOpened()
{
    wxString file = m_frame->GetProjectFileName();
    m_designPath->SetLabel( wxFileName( file ).GetPath() );
    m_designPath->SetToolTip( file );
    m_emptyDesign->Hide();
    m_designTree->Show();
    m_sections->SetSelection( 1 );
    rebuildTree();
    m_sections->GetPage( 1 )->Layout();
    Layout();
}

void PROJECT_WORKSPACE::ProjectClosed()
{
    m_designPath->SetLabel( _( "No project loaded" ) );
    m_designPath->UnsetToolTip();
    m_emptyDesign->Show();
    m_designTree->Hide();
    ShowAllProjects();
    m_sections->GetPage( 1 )->Layout();
    Layout();
}

void PROJECT_WORKSPACE::UpdateLabels()
{
    m_sections->SetPageText( 0, _( "All Projects" ) );
    m_sections->SetPageText( 1, _( "Project Design" ) );
    static_cast<wxButton*>( FindWindow( wxID_ADD ) )->SetLabel( _( "Add Project Folder..." ) );
    static_cast<wxButton*>( FindWindow( wxID_REFRESH ) )->SetLabel( _( "Refresh" ) );
    m_search->SetDescriptiveText( _( "Search projects or paths" ) );
    m_tree->SetName( _( "All Projects" ) );
    if( !m_frame->IsProjectActive() )
        m_designPath->SetLabel( _( "No project loaded" ) );
    m_emptyDesign->SetLabel( _( "Open a project from All Projects to see its design files." ) );
    m_emptyDesign->Wrap( FromDIP( 230 ) );
    rebuildTree();
}

void PROJECT_WORKSPACE::rebuildTree()
{
    m_tree->Freeze();
    m_tree->DeleteAllItems();
    wxTreeItemId root = m_tree->AddRoot( "workspace" );
    const wxString query = m_search->GetValue().Lower();
    const wxString current = m_frame->IsProjectActive() ? m_frame->GetProjectFileName() : wxString();
    size_t count = 0;

    auto addProject = [&]( wxTreeItemId parent, const wxString& file, const wxString& label )
    {
        if( !query.IsEmpty() && !file.Lower().Contains( query ) )
            return;
        wxTreeItemId item = m_tree->AppendItem( parent, label, 1, 1, new ITEM_DATA( file, true ) );
        if( !current.IsEmpty() && samePath( current, file ) )
            m_tree->SetItemBold( item );
        ++count;
    };

    for( const wxString& directory : m_directories )
    {
        wxTreeItemId group = m_tree->AppendItem( root, directory, 0, 0,
                                                new ITEM_DATA( directory, false ) );
        for( const ENTRY& entry : m_entries )
        {
            if( entry.root != directory )
                continue;
            wxFileName label( entry.file );
            label.MakeRelativeTo( directory );
            wxString text = label.GetName();
            if( !label.GetPath().IsEmpty() && label.GetPath() != label.GetName() )
                text += "  —  " + label.GetPath();
            addProject( group, entry.file, text );
        }
        m_tree->Expand( group );
    }

    wxTreeItemId recent = m_tree->AppendItem( root, _( "Recent Projects" ), 0 );
    FILE_HISTORY& history = m_frame->GetFileHistory();
    std::vector<wxString> recentFiles;
    for( size_t i = 0; i < history.GetCount(); ++i )
    {
        wxString file = history.GetHistoryFile( i );
        if( wxFileExists( file ) && std::none_of( recentFiles.begin(), recentFiles.end(),
                [&]( const wxString& old ) { return samePath( old, file ); } ) )
        {
            recentFiles.push_back( file );
            addProject( recent, file, wxFileName( file ).GetName() + "  —  "
                                         + wxFileName( file ).GetPath() );
        }
    }
    m_tree->Expand( recent );
    m_tree->Thaw();

    wxString status = m_directories.empty() ? _( "Add a folder to browse all its projects." )
            : wxString::Format( _( "%zu project entries" ), count );
    if( !query.IsEmpty() && count == 0 )
        status = _( "No matching projects" );
    if( m_limited )
        status += "\n" + _( "Scan limited. Add a more specific folder." );
    m_status->SetLabel( status );
    m_status->Wrap( FromDIP( 260 ) );
    m_allProjects->Layout();
}

void PROJECT_WORKSPACE::onActivate( wxTreeEvent& aEvent )
{
    auto* data = dynamic_cast<ITEM_DATA*>( m_tree->GetItemData( aEvent.GetItem() ) );
    if( !data || !data->project )
        return;
    // Loading rebuilds both trees; retain a value, never a tree-item pointer.
    wxString file = data->path;
    m_frame->CallAfter( [this, file]() { m_frame->LoadProject( wxFileName( file ) ); } );
}

void PROJECT_WORKSPACE::onContextMenu( wxTreeEvent& aEvent )
{
    auto* data = dynamic_cast<ITEM_DATA*>( m_tree->GetItemData( aEvent.GetItem() ) );
    if( !data )
        return;
    const wxString path = data->path;
    wxMenu menu;
    if( data->project )
    {
        menu.Append( wxID_OPEN, _( "Open Project" ) );
        menu.Bind( wxEVT_MENU, [this, path]( wxCommandEvent& )
        {
            m_frame->CallAfter( [this, path]() { m_frame->LoadProject( wxFileName( path ) ); } );
        }, wxID_OPEN );
    }
    else
    {
        menu.Append( wxID_REMOVE, _( "Remove Folder from List" ) );
        menu.Bind( wxEVT_MENU, [this, path]( wxCommandEvent& )
        {
            m_directories.erase( std::remove( m_directories.begin(), m_directories.end(), path ),
                                 m_directories.end() );
            saveDirectories();
            RefreshProjects();
        }, wxID_REMOVE );
    }
    const wxString folder = data->project ? wxFileName( path ).GetPath() : path;
    menu.Append( wxID_INFO, _( "Open Folder in File Manager" ) );
    menu.Bind( wxEVT_MENU, [folder]( wxCommandEvent& ) { LaunchExternal( folder ); }, wxID_INFO );
    PopupMenu( &menu );
}
