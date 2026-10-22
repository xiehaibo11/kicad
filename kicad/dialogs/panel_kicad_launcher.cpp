/*
 * This program source code file is part of KiCad, a free EDA CAD application.
 *
 * Copyright The KiCad Developers, see AUTHORS.txt for contributors.
 *
 * This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU General Public License as published by the
 * Free Software Foundation, either version 3 of the License, or (at your
 * option) any later version.
 *
 * This program is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

#include <bitmaps.h>
#include <bitmap_store.h>
#include <kicad_manager_frame.h>
#include <kiplatform/policy.h>
#include <policy_keys.h>
#include <tool/tool_manager.h>
#include <tools/kicad_manager_actions.h>
#include <tools/kicad_manager_control.h>
#include <widgets/bitmap_button.h>
#include <file_history.h>
#include <wx/button.h>
#include <wx/filename.h>
#include <wx/listctrl.h>
#include <wx/statline.h>
#include <wx/stattext.h>

#include "panel_kicad_launcher.h"
#include <algorithm>


PANEL_KICAD_LAUNCHER::PANEL_KICAD_LAUNCHER( wxWindow* aParent ) :
        PANEL_KICAD_LAUNCHER_BASE( aParent ),
        m_frame( static_cast<KICAD_MANAGER_FRAME*>( aParent->GetParent() ) )
{
    CreateLaunchers();

    m_scrolledWindow->Bind( wxEVT_SIZE, [this]( wxSizeEvent& event )
    {
        updateToolColumns();
        event.Skip();
    } );

    Bind( wxEVT_SYS_COLOUR_CHANGED, wxSysColourChangedEventHandler( PANEL_KICAD_LAUNCHER::onThemeChanged ), this );
}


PANEL_KICAD_LAUNCHER::~PANEL_KICAD_LAUNCHER()
{
    m_frame->SetPcmButton( nullptr );

    for( wxWindow* window : m_scrolledWindow->GetChildren() )
    {
        if( dynamic_cast<BITMAP_BUTTON*>( window ) != nullptr )
            window->Unbind( wxEVT_BUTTON, &PANEL_KICAD_LAUNCHER::onLauncherButtonClick, this );
    }

    Unbind( wxEVT_SYS_COLOUR_CHANGED, wxSysColourChangedEventHandler( PANEL_KICAD_LAUNCHER::onThemeChanged ), this );
}


void PANEL_KICAD_LAUNCHER::onLauncherButtonClick( wxCommandEvent& aEvent )
{
    // BITMAP_BUTTON::OnLeftButtonUp() defers this click via CallAfter(), so CreateLaunchers()
    // can destroy and rebuild the sender before this event is delivered.  aEvent.GetEventObject()
    // may therefore be dangling; aEvent.GetId() is a plain copy made while the button was alive.
    auto it = m_actionForId.find( aEvent.GetId() );

    if( it == m_actionForId.end() )
        return;

    const TOOL_ACTION* action = it->second;

    // Don't accept clicks processed during wxProgressReporter updating.  In particular, the wxSafeYield()
    // call below will puke.
    if( m_frame->GetToolManager()->GetTool<KICAD_MANAGER_CONTROL>()->InShowPlayer() )
        return;

    // Defocus the button because leaving the large buttons focused after a click looks out of place in
    // the launcher
    m_frame->SetFocus();

    // Gives a slice of time to update the button state (mandatory on GTK, useful on MSW to avoid some
    // cosmetic issues).
    wxSafeYield();

    OPT_TOOL_EVENT evt = action->MakeEvent();
    evt->SetHasPosition( false );
    m_frame->GetToolManager()->ProcessEvent( *evt );
}


void PANEL_KICAD_LAUNCHER::CreateLaunchers()
{
    m_frame->SetPcmButton( nullptr );
    m_actionForId.clear();
    m_scrolledWindow->Freeze();
    wxSizer* content = m_scrolledWindow->GetSizer();
    content->Clear( true );
    m_recentProjects = nullptr;
    m_projectLabel = nullptr;
    m_projectPath = nullptr;

    wxFont heading = wxSystemSettings::GetFont( wxSYS_DEFAULT_GUI_FONT );
    heading.SetPointSize( heading.GetPointSize() + 6 );
    heading.SetWeight( wxFONTWEIGHT_BOLD );
    wxFont sectionFont = wxSystemSettings::GetFont( wxSYS_DEFAULT_GUI_FONT );
    sectionFont.SetPointSize( sectionFont.GetPointSize() + 1 );
    sectionFont.SetWeight( wxFONTWEIGHT_BOLD );
    const int margin = FromDIP( 12 );

    auto* header = new wxBoxSizer( wxVERTICAL );
    auto* title = new wxStaticText( m_scrolledWindow, wxID_ANY, _( "KiCad Workspace" ) );
    title->SetFont( heading );
    header->Add( title, 0, wxBOTTOM, FromDIP( 6 ) );
    header->Add( new wxStaticText( m_scrolledWindow, wxID_ANY,
                  _( "Browse projects, open a design, and continue where you left off." ) ),
                 0, wxBOTTOM, FromDIP( 14 ) );
    m_projectLabel = new wxStaticText( m_scrolledWindow, wxID_ANY, wxEmptyString );
    m_projectLabel->SetFont( sectionFont );
    header->Add( m_projectLabel, 0, wxBOTTOM, FromDIP( 3 ) );
    m_projectPath = new wxStaticText( m_scrolledWindow, wxID_ANY, wxEmptyString,
                                     wxDefaultPosition, wxDefaultSize, wxST_ELLIPSIZE_MIDDLE );
    header->Add( m_projectPath, 0, wxEXPAND );
    content->Add( header, 0, wxEXPAND | wxALL, margin );
    content->Add( new wxStaticLine( m_scrolledWindow ), 0, wxEXPAND | wxLEFT | wxRIGHT, margin );

    auto addHeading = [&]( const wxString& text )
    {
        auto* label = new wxStaticText( m_scrolledWindow, wxID_ANY, text );
        label->SetFont( sectionFont );
        content->Add( label, 0, wxLEFT | wxRIGHT | wxTOP, margin );
        content->AddSpacer( FromDIP( 8 ) );
    };

    addHeading( _( "Quick Start" ) );
    auto* quick = new wxBoxSizer( wxHORIZONTAL );
    auto addQuick = [&]( const TOOL_ACTION& action, const wxString& label )
    {
        int id = m_nextLauncherId++;
        auto* button = new wxButton( m_scrolledWindow, id, label );
        button->Bind( wxEVT_BUTTON, &PANEL_KICAD_LAUNCHER::onLauncherButtonClick, this );
        m_actionForId[id] = &action;
        quick->Add( button, 1, wxRIGHT, FromDIP( 8 ) );
    };
    addQuick( KICAD_MANAGER_ACTIONS::newProject, _( "New Project" ) );
    addQuick( KICAD_MANAGER_ACTIONS::openProject, _( "Open Project" ) );
    addQuick( KICAD_MANAGER_ACTIONS::browseProjectDirectory, _( "Add Project Folder..." ) );
    content->Add( quick, 0, wxEXPAND | wxLEFT | wxRIGHT, margin );

    addHeading( _( "Project Tools" ) );
    m_toolsSizer = new wxFlexGridSizer( 0, 3, FromDIP( 10 ), FromDIP( 10 ) );
    for( int col = 0; col < 3; ++col )
        m_toolsSizer->AddGrowableCol( col );

    auto addLauncher = [&]( const TOOL_ACTION& action, BITMAPS bitmap,
                            const wxString& helpText, bool enabled = true )
    {
        int id = m_nextLauncherId++;
        auto* card = new wxPanel( m_scrolledWindow, wxID_ANY, wxDefaultPosition,
                                  wxDefaultSize, wxBORDER_SIMPLE );
        auto* row = new wxBoxSizer( wxHORIZONTAL );
        auto* button = new BITMAP_BUTTON( card, id );
        button->SetBitmap( KiBitmapBundleDef( bitmap, 32 ) );
        button->SetDisabledBitmap( KiDisabledBitmapBundle( bitmap ) );
        button->SetPadding( 4 );
        button->SetName( action.GetFriendlyName() );
        button->SetToolTip( action.GetTooltip() );
        button->Bind( wxEVT_BUTTON, &PANEL_KICAD_LAUNCHER::onLauncherButtonClick, this );
        m_actionForId[id] = &action;
        row->Add( button, 0, wxALIGN_CENTER_VERTICAL | wxALL, FromDIP( 8 ) );
        auto* labels = new wxBoxSizer( wxVERTICAL );
        auto* label = new wxStaticText( card, wxID_ANY, action.GetFriendlyName() );
        label->SetFont( wxSystemSettings::GetFont( wxSYS_DEFAULT_GUI_FONT ).Bold() );
        label->Wrap( FromDIP( 120 ) );
        auto* help = new wxStaticText( card, wxID_ANY, helpText );
        help->Wrap( FromDIP( 120 ) );
        labels->Add( label, 0, wxBOTTOM, FromDIP( 4 ) );
        labels->Add( help );
        row->Add( labels, 1, wxALIGN_CENTER_VERTICAL | wxTOP | wxBOTTOM | wxRIGHT, FromDIP( 10 ) );
        card->SetSizer( row );
        card->SetToolTip( action.GetTooltip() );
        wxWindow* targets[] = { card, label, help };
        for( wxWindow* target : targets )
        {
            target->Bind( wxEVT_LEFT_UP, [this, id]( wxMouseEvent& )
            {
                wxCommandEvent click( wxEVT_BUTTON, id );
                onLauncherButtonClick( click );
            } );
        }
        card->Enable( enabled );
        m_toolsSizer->Add( card, 1, wxEXPAND );
        return button;
    };

    addLauncher( KICAD_MANAGER_ACTIONS::editSchematic, BITMAPS::icon_eeschema,
                 _( "Edit the project schematic" ) );
    addLauncher( KICAD_MANAGER_ACTIONS::editPCB, BITMAPS::icon_pcbnew,
                 _( "Edit the project PCB design" ) );
    addLauncher( KICAD_MANAGER_ACTIONS::editSymbols, BITMAPS::icon_libedit,
                 _( "Edit symbol libraries" ) );
    addLauncher( KICAD_MANAGER_ACTIONS::editFootprints, BITMAPS::icon_modedit,
                 _( "Edit footprint libraries" ) );
    addLauncher( KICAD_MANAGER_ACTIONS::viewGerbers, BITMAPS::icon_gerbview,
                 _( "Preview Gerber files" ) );
    addLauncher( KICAD_MANAGER_ACTIONS::showCalculator, BITMAPS::icon_pcbcalculator,
                 _( "PCB engineering calculators" ) );
    addLauncher( KICAD_MANAGER_ACTIONS::convertImage, BITMAPS::icon_bitmap2component,
                 _( "Convert images into symbols or footprints" ) );
    addLauncher( KICAD_MANAGER_ACTIONS::editDrawingSheet, BITMAPS::icon_pagelayout_editor,
                 _( "Edit drawing sheet borders and title blocks" ) );
    BITMAP_BUTTON* pcm = addLauncher( KICAD_MANAGER_ACTIONS::showPluginManager, BITMAPS::icon_pcm,
                 _( "Manage plugins and content" ),
                 KIPLATFORM::POLICY::GetPolicyBool( POLICY_KEY_PCM )
                         != KIPLATFORM::POLICY::PBOOL::DISABLED );
    m_frame->SetPcmButton( pcm );
    content->Add( m_toolsSizer, 0, wxEXPAND | wxLEFT | wxRIGHT, margin );

    addHeading( _( "Recent Projects" ) );
    m_recentProjects = new wxListCtrl( m_scrolledWindow, wxID_ANY, wxDefaultPosition,
                                      FromDIP( wxSize( -1, 150 ) ),
                                      wxLC_REPORT | wxLC_SINGLE_SEL | wxLC_HRULES );
    // Column widths are scrollable content, not the minimum width of the start page.
    m_recentProjects->SetMinSize( FromDIP( wxSize( 1, 150 ) ) );
    m_recentProjects->SetName( _( "Recent Projects" ) );
    m_recentProjects->AppendColumn( _( "Project Name" ), wxLIST_FORMAT_LEFT, FromDIP( 170 ) );
    m_recentProjects->AppendColumn( _( "Project Path" ), wxLIST_FORMAT_LEFT, FromDIP( 380 ) );
    m_recentProjects->AppendColumn( _( "Updated" ), wxLIST_FORMAT_LEFT, FromDIP( 145 ) );
    m_recentProjects->Bind( wxEVT_LIST_ITEM_ACTIVATED, [this]( wxListEvent& event )
    {
        if( event.GetIndex() >= 0 && static_cast<size_t>( event.GetIndex() ) < m_recentPaths.size() )
        {
            wxString file = m_recentPaths[event.GetIndex()];
            m_frame->CallAfter( [this, file]() { m_frame->LoadProject( wxFileName( file ) ); } );
        }
    } );
    content->Add( m_recentProjects, 0, wxEXPAND | wxLEFT | wxRIGHT | wxBOTTOM, margin );
    RefreshProjects();
    updateToolColumns();
    m_scrolledWindow->FitInside();
    m_scrolledWindow->Thaw();
    Layout();
}


void PANEL_KICAD_LAUNCHER::updateToolColumns()
{
    const int available = m_scrolledWindow->GetClientSize().x - FromDIP( 24 );
    const int cols = std::clamp( available / FromDIP( 190 ), 1, 3 );
    if( cols == m_toolsSizer->GetCols() )
        return;
    for( int old = 0; old < m_toolsSizer->GetCols(); ++old )
        m_toolsSizer->RemoveGrowableCol( old );
    m_toolsSizer->SetCols( cols );
    for( int col = 0; col < cols; ++col )
        m_toolsSizer->AddGrowableCol( col );
    m_scrolledWindow->Layout();
    m_scrolledWindow->FitInside();
}


void PANEL_KICAD_LAUNCHER::RefreshProjects()
{
    if( !m_recentProjects )
        return;

    const bool active = m_frame->IsProjectActive();
    wxString file = active ? m_frame->GetProjectFileName() : wxString();
    m_projectLabel->SetLabel( active ? _( "Current Project" ) + ": " + wxFileName( file ).GetName()
                                    : _( "No project loaded" ) );
    m_projectPath->SetLabel( file );
    m_projectPath->SetToolTip( file );
    m_recentProjects->DeleteAllItems();
    m_recentPaths.clear();
    FILE_HISTORY& history = m_frame->GetFileHistory();

    for( size_t i = 0; i < history.GetCount(); ++i )
    {
        wxFileName project( history.GetHistoryFile( i ) );
        if( !project.FileExists() )
            continue;
        if( std::any_of( m_recentPaths.begin(), m_recentPaths.end(),
                [&]( const wxString& old ) { return project.SameAs( wxFileName( old ) ); } ) )
            continue;
        long row = m_recentProjects->InsertItem( m_recentProjects->GetItemCount(), project.GetName() );
        m_recentProjects->SetItem( row, 1, project.GetFullPath() );
        wxDateTime modified = project.GetModificationTime();
        if( modified.IsValid() )
            m_recentProjects->SetItem( row, 2, modified.FormatISOCombined( ' ' ) );
        m_recentPaths.push_back( project.GetFullPath() );
    }
    m_scrolledWindow->Layout();
}


void PANEL_KICAD_LAUNCHER::onThemeChanged( wxSysColourChangedEvent& aEvent )
{
    GetBitmapStore()->ThemeChanged();
    CreateLaunchers();

    aEvent.Skip();
}
