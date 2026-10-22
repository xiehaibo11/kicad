/*
 * This file is part of KiCad, a free EDA CAD application.
 * Copyright The KiCad Developers, see AUTHORS.txt for contributors.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
#pragma once

#include <wx/app.h>
#include <wx/aui/auibook.h>
#include <wx/frame.h>
#include <wx/menu.h>
#include <wx/statusbr.h>
#include <kiway.h>

/** A frame that can be created as a real notebook child, like wxTDIChildFrame.
 * Editor objects and their tools remain alive when another document is selected.
 * Standalone editors and dialogs retain their normal top-level window behavior.
 */
class WORKSPACE_FRAME : public wxFrame
{
public:
    WORKSPACE_FRAME( wxWindow* aParent, FRAME_T aType, const wxString& aTitle, const wxPoint& aPos, const wxSize& aSize,
                     long aStyle, const wxString& aName, KIWAY* aKiway );

    ~WORKSPACE_FRAME() override;

    bool         IsWorkspacePage() const;
    wxFrame*     WorkspaceHost() const;
    wxMenuBar*   WorkspaceMenu() const;
    wxStatusBar* WorkspaceStatus() const;
    void         SetWorkspaceStatus( wxStatusBar* aStatus );

    bool         IsTopLevel() const override;
    bool         IsActive() override;
    bool         Show( bool aShow = true ) override;
    void         Raise() override;
    bool         Destroy() override;
    void         SetTitle( const wxString& aTitle ) override;
    wxString     GetTitle() const override;
    void         SetMenuBar( wxMenuBar* aMenu ) override;
    wxMenuBar*   GetMenuBar() const override;
    wxStatusBar* GetStatusBar() const override;
    void         SetStatusText( const wxString& aText, int aField = 0 ) override;
    void         SetStatusWidths( int aCount, const int* aWidths ) override;
    void         Maximize( bool aValue = true ) override;
    bool         IsMaximized() const override;
    bool         IsAlwaysMaximized() const override;
    void         Iconize( bool aValue = true ) override;
    bool         IsIconized() const override;
    void         Restore() override;
    void         SetIcons( const wxIconBundle& aIcons ) override;
    bool         ShowFullScreen( bool aShow, long aStyle = wxFULLSCREEN_ALL ) override;
    bool         IsFullScreen() const override;
    void         AddChild( wxWindowBase* aChild ) override;
    wxPoint      GetClientAreaOrigin() const override;

#ifdef __WXMSW__
    WXDWORD   MSWGetStyle( long flags, WXDWORD* exstyle = nullptr ) const override;
    WXHWND    MSWGetParent() const override;
    WXLRESULT MSWWindowProc( WXUINT message, WXWPARAM wParam, WXLPARAM lParam ) override;
#endif

    bool CanSetTransparent() override;
    bool SetTransparent( wxByte aAlpha ) override;
    bool SetBackgroundStyle( wxBackgroundStyle aStyle ) override;
    bool SetBackgroundColour( const wxColour& aColour ) override;
    void Update() override;
    void SetWindowStyleFlag( long aFlags ) override;
    void SetExtraStyle( long aStyle ) override;
    void Lower() override;
    bool Enable( bool aEnable = true ) override;
    void ShowWithoutActivating() override;
    void RequestUserAttention( int aFlags = wxUSER_ATTENTION_INFO ) override;
    void DoGetPosition( int* x, int* y ) const override;

#ifdef __WXMAC__
    void* OSXGetViewOrWindow() const override;
    void  OSXSetModified( bool aModified ) override;
    bool  OSXIsModified() const override;
    void  SetRepresentedFilename( const wxString& aName ) override;
#endif

protected:
    void DoGetSize( int* w, int* h ) const override;
    void DoSetSize( int x, int y, int w, int h, int flags ) override;
    void DoGetClientSize( int* w, int* h ) const override;
    void DoSetClientSize( int w, int h ) override;
    void DoMoveWindow( int x, int y, int w, int h ) override;
    void DoGetScreenPosition( int* x, int* y ) const override;
    void DoSetSizeHints( int minW, int minH, int maxW, int maxH, int incW, int incH ) override;

private:
    bool           m_destroyScheduled = false;
    bool           m_selecting = false;
    wxAuiNotebook* m_book = nullptr;
    wxFrame*       m_host = nullptr;
    wxString       m_title;
    wxMenuBar*     m_pageMenu = nullptr;
    wxStatusBar*   m_pageStatus = nullptr;
};
