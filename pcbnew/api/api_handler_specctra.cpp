// SPDX-License-Identifier: GPL-3.0-or-later
#include <api/api_handler_board.h>
#include <board_commit.h>
#include <specctra_import_export/specctra.h>
#include <tool/actions.h>
#include <tool/tool_manager.h>
#include <wx/filename.h>

HANDLER_RESULT<Empty> API_HANDLER_BOARD::handleExportSpecctra(
        const HANDLER_CONTEXT<ExportSpecctraBoard>& aCtx )
{
    if( auto validation = validateDocument( aCtx.Request.board() ); !validation )
        return tl::unexpected( validation.error() );

    wxFileName output( wxString::FromUTF8( aCtx.Request.output_path() ) );
    ApiResponseStatus error;
    error.set_status( ApiStatusCode::AS_BAD_REQUEST );

    if( !output.IsAbsolute() || output.GetExt().CmpNoCase( wxS( "dsn" ) ) != 0
        || output.FileExists() )
    {
        error.set_error_message( "output_path must be a new absolute .dsn filename" );
        return tl::unexpected( error );
    }

    try
    {
        DSN::ExportBoardToSpecctraFile( board(), output.GetFullPath() );
    }
    catch( const std::exception& e )
    {
        wxRemoveFile( output.GetFullPath() );
        error.set_error_message( e.what() );
        return tl::unexpected( error );
    }
    catch( const IO_ERROR& e )
    {
        wxRemoveFile( output.GetFullPath() );
        error.set_error_message( e.What().ToStdString() );
        return tl::unexpected( error );
    }

    return Empty();
}

HANDLER_RESULT<Empty> API_HANDLER_BOARD::handleImportSpecctra(
        const HANDLER_CONTEXT<ImportSpecctraRoutes>& aCtx )
{
    if( auto validation = validateDocument( aCtx.Request.board() ); !validation )
        return tl::unexpected( validation.error() );

    wxFileName input( wxString::FromUTF8( aCtx.Request.session_path() ) );
    ApiResponseStatus error;
    error.set_status( ApiStatusCode::AS_BAD_REQUEST );

    if( !input.IsAbsolute() || input.GetExt().CmpNoCase( wxS( "ses" ) ) != 0
        || !input.FileExists() )
    {
        error.set_error_message( "session_path must be an existing absolute .ses filename" );
        return tl::unexpected( error );
    }

    auto commit = createCommit();
    auto boardCommit = dynamic_cast<BOARD_COMMIT*>( commit.get() );

    if( !boardCommit )
    {
        error.set_error_message( "Cannot create native board undo commit" );
        return tl::unexpected( error );
    }

    if( toolManager() )
        toolManager()->RunAction( ACTIONS::selectionClear );

    try
    {
        DSN::ImportSpecctraSession( board(), input.GetFullPath(), *commit );
        boardCommit->Push( wxS( "Import Specctra Session via Native API" ) );
        onModified();
    }
    catch( const IO_ERROR& e )
    {
        commit->Revert();
        error.set_error_message( e.What().ToStdString() );
        return tl::unexpected( error );
    }
    catch( const std::exception& e )
    {
        commit->Revert();
        error.set_error_message( e.what() );
        return tl::unexpected( error );
    }

    return Empty();
}
