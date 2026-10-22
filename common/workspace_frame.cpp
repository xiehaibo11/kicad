/*
 * This file is part of KiCad, a free EDA CAD application.
 * Copyright The KiCad Developers, see AUTHORS.txt for contributors.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
#include <workspace_frame.h>


WORKSPACE_FRAME::WORKSPACE_FRAME( wxWindow* aParent, FRAME_T aType, const wxString& aTitle, const wxPoint& aPos,
                                  const wxSize& aSize, long aStyle, const wxString& aName, KIWAY* aKiway )
{
    wxString disabled;
    if( !aParent && aKiway && aKiway->GetTop() && ( aType == FRAME_SCH || aType == FRAME_PCB_EDITOR )
        && !( wxGetEnv( wxS( "KICAD_SINGLE_WINDOW" ), &disabled ) && disabled == wxS( "0" ) ) )
    {
        m_book = dynamic_cast<wxAuiNotebook*>(
                wxWindow::FindWindowByName( wxS( "KiCadWorkspaceEditors" ), aKiway->GetTop() ) );
    }

    if( m_book )
    {
        m_host = aKiway->GetTop();
        m_title = aTitle;
        wxWindow::Create( m_book, wxID_ANY, wxDefaultPosition, aSize, wxWANTS_CHARS | wxTAB_TRAVERSAL, aName );
        wxWindow::Show( false );
    }
    else
    {
        wxFrame::Create( aParent, wxID_ANY, aTitle, aPos, aSize, aStyle, aName );
    }
}


WORKSPACE_FRAME::~WORKSPACE_FRAME()
{
    // Menus are attached to the host only while this page is selected.
    // Removing the page selects the next menu before this object is deleted.
    if( m_book )
        delete m_pageMenu;
}


bool WORKSPACE_FRAME::IsWorkspacePage() const
{
    return m_book != nullptr;
}


wxFrame* WORKSPACE_FRAME::WorkspaceHost() const
{
    return m_host;
}


wxMenuBar* WORKSPACE_FRAME::WorkspaceMenu() const
{
    return m_pageMenu;
}


wxStatusBar* WORKSPACE_FRAME::WorkspaceStatus() const
{
    return m_pageStatus;
}


void WORKSPACE_FRAME::SetWorkspaceStatus( wxStatusBar* aStatus )
{
    m_pageStatus = aStatus;
}


bool WORKSPACE_FRAME::IsTopLevel() const
{
    return m_book ? false : wxFrame::IsTopLevel();
}


bool WORKSPACE_FRAME::IsActive()
{
    return m_book ? m_book->GetCurrentPage() == this && m_host->IsActive() : wxFrame::IsActive();
}


bool WORKSPACE_FRAME::Show( bool aShow )
{
    if( !m_book )
        return wxFrame::Show( aShow );

    int index = m_book->GetPageIndex( this );
    // AUI may show its managed window during construction. Do not publish an
    // editor page before KIWAY has registered it and its document is loaded.
    if( index == wxNOT_FOUND )
        return wxWindow::Show( false );

    if( aShow && !m_selecting )
    {
        m_selecting = true;
        m_book->SetSelection( index );
        m_selecting = false;
    }
    return wxWindow::Show( aShow );
}


void WORKSPACE_FRAME::Raise()
{
    if( !m_book )
    {
        wxFrame::Raise();
        return;
    }

    m_selecting = true;
    int index = m_book->GetPageIndex( this );
    if( index == wxNOT_FOUND )
        m_book->AddPage( this, m_title, true );
    else
        m_book->SetSelection( index );
    m_selecting = false;
    wxWindow::Show( true );
    m_host->Show();
    m_host->Raise();
    SetFocus();
}


bool WORKSPACE_FRAME::Destroy()
{
    if( !m_book )
        return wxFrame::Destroy();
    if( m_destroyScheduled )
        return true;
    m_destroyScheduled = true;
    int index = m_book->GetPageIndex( this );
    if( index != wxNOT_FOUND )
        m_book->RemovePage( index );
    wxWindow::Show( false );
    // Editor close handlers and their guards still run after Destroy().
    // Preserve wxFrame's deferred deletion semantics for notebook children.
    wxTheApp->ScheduleForDestruction( this );
    return true;
}


void WORKSPACE_FRAME::SetTitle( const wxString& aTitle )
{
    if( !m_book )
    {
        wxFrame::SetTitle( aTitle );
        return;
    }
    m_title = aTitle;
    int index = m_book->GetPageIndex( this );
    if( index != wxNOT_FOUND )
        m_book->SetPageText( index, aTitle );
}


wxString WORKSPACE_FRAME::GetTitle() const
{
    return m_book ? m_title : wxFrame::GetTitle();
}


void WORKSPACE_FRAME::SetMenuBar( wxMenuBar* aMenu )
{
    if( !m_book )
    {
        wxFrame::SetMenuBar( aMenu );
        return;
    }
    m_pageMenu = aMenu;
    if( m_book->GetCurrentPage() == this )
        m_host->SetMenuBar( aMenu );
}


wxMenuBar* WORKSPACE_FRAME::GetMenuBar() const
{
    return m_book ? m_pageMenu : wxFrame::GetMenuBar();
}


wxStatusBar* WORKSPACE_FRAME::GetStatusBar() const
{
    return m_book ? m_pageStatus : wxFrame::GetStatusBar();
}


void WORKSPACE_FRAME::SetStatusText( const wxString& aText, int aField )
{
    if( !m_book )
        wxFrame::SetStatusText( aText, aField );
    else if( m_pageStatus )
        m_pageStatus->SetStatusText( aText, aField );
}


void WORKSPACE_FRAME::SetStatusWidths( int aCount, const int* aWidths )
{
    if( !m_book )
        wxFrame::SetStatusWidths( aCount, aWidths );
    else if( m_pageStatus )
        m_pageStatus->SetStatusWidths( aCount, aWidths );
}


void WORKSPACE_FRAME::Maximize( bool aValue )
{
    if( !m_book )
        wxFrame::Maximize( aValue );
}


bool WORKSPACE_FRAME::IsMaximized() const
{
    return m_book ? true : wxFrame::IsMaximized();
}


bool WORKSPACE_FRAME::IsAlwaysMaximized() const
{
    return m_book ? true : wxFrame::IsAlwaysMaximized();
}


void WORKSPACE_FRAME::Iconize( bool aValue )
{
    if( !m_book )
        wxFrame::Iconize( aValue );
}


bool WORKSPACE_FRAME::IsIconized() const
{
    return m_book ? false : wxFrame::IsIconized();
}


void WORKSPACE_FRAME::Restore()
{
    if( !m_book )
        wxFrame::Restore();
}


void WORKSPACE_FRAME::SetIcons( const wxIconBundle& aIcons )
{
    if( !m_book )
        wxFrame::SetIcons( aIcons );
}


bool WORKSPACE_FRAME::ShowFullScreen( bool aShow, long aStyle )
{
    return m_book ? m_host->ShowFullScreen( aShow, aStyle ) : wxFrame::ShowFullScreen( aShow, aStyle );
}


bool WORKSPACE_FRAME::IsFullScreen() const
{
    return m_book ? m_host->IsFullScreen() : wxFrame::IsFullScreen();
}


void WORKSPACE_FRAME::AddChild( wxWindowBase* aChild )
{
    if( m_book )
        wxWindow::AddChild( aChild );
    else
        wxFrame::AddChild( aChild );
}


wxPoint WORKSPACE_FRAME::GetClientAreaOrigin() const
{
    return m_book ? wxWindow::GetClientAreaOrigin() : wxFrame::GetClientAreaOrigin();
}


#ifdef __WXMSW__
WXDWORD WORKSPACE_FRAME::MSWGetStyle( long flags, WXDWORD* exstyle ) const
{
    return m_book ? wxWindow::MSWGetStyle( flags, exstyle ) : wxFrame::MSWGetStyle( flags, exstyle );
}
#endif


#ifdef __WXMSW__
WXHWND WORKSPACE_FRAME::MSWGetParent() const
{
    return m_book ? wxWindow::MSWGetParent() : wxFrame::MSWGetParent();
}
#endif


#ifdef __WXMSW__
WXLRESULT WORKSPACE_FRAME::MSWWindowProc( WXUINT message, WXWPARAM wParam, WXLPARAM lParam )
{
    return m_book ? wxWindow::MSWWindowProc( message, wParam, lParam )
                  : wxFrame::MSWWindowProc( message, wParam, lParam );
}
#endif


void WORKSPACE_FRAME::DoGetSize( int* w, int* h ) const
{
    if( m_book )
        wxWindow::DoGetSize( w, h );
    else
        wxFrame::DoGetSize( w, h );
}


void WORKSPACE_FRAME::DoSetSize( int x, int y, int w, int h, int flags )
{
    if( m_book )
        wxWindow::DoSetSize( x, y, w, h, flags );
    else
        wxFrame::DoSetSize( x, y, w, h, flags );
}


void WORKSPACE_FRAME::DoGetClientSize( int* w, int* h ) const
{
    if( m_book )
        wxWindow::DoGetClientSize( w, h );
    else
        wxFrame::DoGetClientSize( w, h );
}


void WORKSPACE_FRAME::DoSetClientSize( int w, int h )
{
    if( m_book )
        wxWindow::DoSetClientSize( w, h );
    else
        wxFrame::DoSetClientSize( w, h );
}


void WORKSPACE_FRAME::DoMoveWindow( int x, int y, int w, int h )
{
    if( m_book )
        wxWindow::DoMoveWindow( x, y, w, h );
    else
        wxFrame::DoMoveWindow( x, y, w, h );
}


void WORKSPACE_FRAME::DoGetScreenPosition( int* x, int* y ) const
{
    if( m_book )
        wxWindow::DoGetScreenPosition( x, y );
    else
        wxFrame::DoGetScreenPosition( x, y );
}


void WORKSPACE_FRAME::DoSetSizeHints( int minW, int minH, int maxW, int maxH, int incW, int incH )
{
    if( !m_book )
        wxFrame::DoSetSizeHints( minW, minH, maxW, maxH, incW, incH );
}


bool WORKSPACE_FRAME::CanSetTransparent()
{
    return m_book ? m_host->CanSetTransparent() : wxFrame::CanSetTransparent();
}

bool WORKSPACE_FRAME::SetTransparent( wxByte aAlpha )
{
    return m_book ? m_host->SetTransparent( aAlpha ) : wxFrame::SetTransparent( aAlpha );
}

bool WORKSPACE_FRAME::SetBackgroundStyle( wxBackgroundStyle aStyle )
{
    return m_book ? wxWindow::SetBackgroundStyle( aStyle ) : wxFrame::SetBackgroundStyle( aStyle );
}

bool WORKSPACE_FRAME::SetBackgroundColour( const wxColour& aColour )
{
    return m_book ? wxWindow::SetBackgroundColour( aColour ) : wxFrame::SetBackgroundColour( aColour );
}

void WORKSPACE_FRAME::Update()
{
    if( m_book )
        wxWindow::Update();
    else
        wxFrame::Update();
}

void WORKSPACE_FRAME::SetWindowStyleFlag( long aFlags )
{
    if( m_book )
        wxWindow::SetWindowStyleFlag( aFlags );
    else
        wxFrame::SetWindowStyleFlag( aFlags );
}

void WORKSPACE_FRAME::SetExtraStyle( long aStyle )
{
    if( m_book )
        wxWindow::SetExtraStyle( aStyle );
    else
        wxFrame::SetExtraStyle( aStyle );
}

void WORKSPACE_FRAME::Lower()
{
    if( m_book )
        m_host->Lower();
    else
        wxFrame::Lower();
}

bool WORKSPACE_FRAME::Enable( bool aEnable )
{
    return m_book ? wxWindow::Enable( aEnable ) : wxFrame::Enable( aEnable );
}

void WORKSPACE_FRAME::ShowWithoutActivating()
{
    if( m_book )
        wxWindow::Show();
    else
        wxFrame::ShowWithoutActivating();
}

void WORKSPACE_FRAME::RequestUserAttention( int aFlags )
{
    if( m_book )
        m_host->RequestUserAttention( aFlags );
    else
        wxFrame::RequestUserAttention( aFlags );
}

void WORKSPACE_FRAME::DoGetPosition( int* x, int* y ) const
{
    if( m_book )
        wxWindow::DoGetPosition( x, y );
    else
        wxFrame::DoGetPosition( x, y );
}


#ifdef __WXMAC__
void* WORKSPACE_FRAME::OSXGetViewOrWindow() const
{
    return m_book ? wxWindow::OSXGetViewOrWindow() : wxFrame::OSXGetViewOrWindow();
}

void WORKSPACE_FRAME::OSXSetModified( bool aModified )
{
    if( !m_book )
        wxFrame::OSXSetModified( aModified );
}

bool WORKSPACE_FRAME::OSXIsModified() const
{
    return m_book ? m_title.StartsWith( wxS( "*" ) ) : wxFrame::OSXIsModified();
}

void WORKSPACE_FRAME::SetRepresentedFilename( const wxString& aName )
{
    if( !m_book )
        wxFrame::SetRepresentedFilename( aName );
}
#endif
