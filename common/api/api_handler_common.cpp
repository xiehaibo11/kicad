/*
 * This program source code file is part of KiCad, a free EDA CAD application.
 *
 * Copyright (C) 2023 Jon Evans <jon@craftyjon.com>
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

#include <algorithm>
#include <ranges>
#include <tuple>
#include <vector>

#include <api/api_handler_common.h>
#include <api/api_server.h>
#include <jobs/job_status_registry.h>
#include <build_version.h>
#include <fmt/format.h>
#include <eda_shape.h>
#include <eda_text.h>
#include <gestfich.h>
#include <geometry/shape_compound.h>
#include <google/protobuf/empty.pb.h>
#include <paths.h>
#include <pgm_base.h>
#include <api/api_plugin.h>
#include <api/api_utils.h>
#include <project/net_settings.h>
#include <project/project_file.h>
#include <settings/settings_manager.h>
#include <wx/string.h>
#include <eda_base_frame.h>
#include <kiway.h>
#include <kiway_player.h>
#include <tool/tool_manager.h>
#include <wx/toplevel.h>

using namespace kiapi::common::commands;
using namespace kiapi::common::types;
using google::protobuf::Empty;


API_HANDLER_COMMON::API_HANDLER_COMMON() :
        API_HANDLER()
{
    registerHandler<RunAction, RunActionResponse>( &API_HANDLER_COMMON::handleRunAction );
    registerHandler<commands::GetVersion, GetVersionResponse>( &API_HANDLER_COMMON::handleGetVersion );
    registerHandler<GetKiCadBinaryPath, PathResponse>(
            &API_HANDLER_COMMON::handleGetKiCadBinaryPath );
    registerHandler<GetPaths, GetPathsResponse>( &API_HANDLER_COMMON::handleGetPaths );
    registerHandler<GetCapabilities, GetCapabilitiesResponse>(
            &API_HANDLER_COMMON::handleGetCapabilities );
    registerHandler<GetJobStatus, JobStatusResponse>(
            &API_HANDLER_COMMON::handleGetJobStatus );
    registerHandler<CancelJob, CancelJobResponse>(
            &API_HANDLER_COMMON::handleCancelJob );
    registerHandler<GetNetClasses, NetClassesResponse>( &API_HANDLER_COMMON::handleGetNetClasses );
    registerHandler<SetNetClasses, Empty>( &API_HANDLER_COMMON::handleSetNetClasses );
    registerHandler<Ping, Empty>( &API_HANDLER_COMMON::handlePing );
    registerHandler<GetTextExtents, types::Box2>( &API_HANDLER_COMMON::handleGetTextExtents );
    registerHandler<GetTextAsShapes, GetTextAsShapesResponse>(
            &API_HANDLER_COMMON::handleGetTextAsShapes );
    registerHandler<ExpandTextVariables, ExpandTextVariablesResponse>(
            &API_HANDLER_COMMON::handleExpandTextVariables );
    registerHandler<GetPluginSettingsPath, StringResponse>(
            &API_HANDLER_COMMON::handleGetPluginSettingsPath );
    registerHandler<GetTextVariables, project::TextVariables>(
            &API_HANDLER_COMMON::handleGetTextVariables );
    registerHandler<SetTextVariables, Empty>(
            &API_HANDLER_COMMON::handleSetTextVariables );
    registerHandler<OpenDocument, OpenDocumentResponse>(
            &API_HANDLER_COMMON::handleOpenDocument );
    registerHandler<CloseDocument, Empty>(
            &API_HANDLER_COMMON::handleCloseDocument );
    registerHandler<CloseAllDocuments, Empty>(
            &API_HANDLER_COMMON::handleCloseAllDocuments );
    registerHandler<CreateDocument, OpenDocumentResponse>(
            &API_HANDLER_COMMON::handleCreateDocument );
}


HANDLER_RESULT<RunActionResponse> API_HANDLER_COMMON::handleRunAction(
        const HANDLER_CONTEXT<RunAction>& aCtx )
{
    wxString action = wxString::FromUTF8( aCtx.Request.action() );
    wxString editor = wxString::FromUTF8( aCtx.Request.editor() ).Lower();

    if( editor.IsEmpty() && !action.StartsWith( wxS( "common." ) ) )
        editor = action.BeforeFirst( '.' ).Lower();

    auto matches = [&]( FRAME_T type )
    {
        if( editor.IsEmpty() )
            return true;
        if( editor == wxS( "pcbnew" ) || editor == wxS( "pcb" ) )
            return type == FRAME_PCB_EDITOR;
        if( editor == wxS( "eeschema" ) || editor == wxS( "schematic" ) )
            return type == FRAME_SCH;
        if( editor == wxS( "symbol_editor" ) )
            return type == FRAME_SCH_SYMBOL_EDITOR;
        if( editor == wxS( "footprint_editor" ) )
            return type == FRAME_FOOTPRINT_EDITOR;
        if( editor == wxS( "gerbview" ) )
            return type == FRAME_GERBER;
        if( editor == wxS( "3d-viewer" ) || editor == wxS( "3dviewer" ) )
            return type == FRAME_PCB_DISPLAY3D;
        if( editor == wxS( "cvpcb" ) )
            return type == FRAME_CVPCB;
        if( editor == wxS( "pl_editor" ) || editor == wxS( "pleditor" )
            || editor == wxS( "pagelayout_editor" ) )
            return type == FRAME_PL_EDITOR;
        if( editor == wxS( "kicad" ) )
            return type == KICAD_MAIN_FRAME_T;
        return false;
    };

    std::vector<EDA_BASE_FRAME*> candidates;

    auto addCandidate = [&]( EDA_BASE_FRAME* frame )
    {
        if( frame && !frame->IsBeingDeleted() && frame->GetToolManager()
            && matches( frame->GetFrameType() )
            && std::find( candidates.begin(), candidates.end(), frame ) == candidates.end() )
        {
            candidates.push_back( frame );
        }
    };

    for( wxWindow* window : wxTopLevelWindows )
    {
        EDA_BASE_FRAME* frame = dynamic_cast<EDA_BASE_FRAME*>( window );

        if( !frame || frame->IsBeingDeleted() )
            continue;

        addCandidate( frame );

        // On macOS each KIFACE has hidden C++ RTTI. A dynamic_cast from the
        // manager cannot identify editor classes in another module. KIWAY is
        // the supported cross-module interface and returns typed player bases.
        if( frame->HasKiway() )
        {
            for( int type = 0; type < KIWAY_PLAYER_COUNT; ++type )
                addCandidate( frame->Kiway().Player( static_cast<FRAME_T>( type ), false ) );
        }
    }

    RunActionResponse response;

    if( candidates.empty() )
    {
        // Give other KIFACEs' common handlers a chance. Some associated
        // windows (notably the 3D viewer) are owned directly by their editor,
        // rather than being registered as KIWAY players.
        ApiResponseStatus error;
        error.set_status( ApiStatusCode::AS_UNHANDLED );
        error.set_error_message( "The requested editor frame is not available in this module" );
        return tl::unexpected( error );
    }

    // Never send a common action to whichever editor happened to register
    // first. Require a target if multiple frames could receive the request.
    if( candidates.size() > 1 )
    {
        ApiResponseStatus error;
        error.set_status( ApiStatusCode::AS_BAD_REQUEST );
        error.set_error_message( "Several editor frames match; specify editor explicitly and close duplicate frames" );
        return tl::unexpected( error );
    }

    EDA_BASE_FRAME* frame = candidates.front();

    if( !frame->IsEnabled() )
    {
        ApiResponseStatus error;
        error.set_status( ApiStatusCode::AS_BUSY );
        error.set_error_message( "The target editor is blocked by a dialog" );
        return tl::unexpected( error );
    }

    // Keep each TOOL_ACTION's default parameter. Passing a boolean here is a
    // tool parameter, not an "immediate" flag (and breaks typed GUI actions).
    response.set_status( frame->GetToolManager()->RunAction( action.ToStdString() )
                                 ? RunActionStatus::RAS_OK : RunActionStatus::RAS_INVALID );
    return response;
}


HANDLER_RESULT<GetVersionResponse> API_HANDLER_COMMON::handleGetVersion(
        const HANDLER_CONTEXT<commands::GetVersion>& )
{
    GetVersionResponse reply;

    reply.mutable_version()->set_full_version( GetBuildVersion().ToStdString() );

    std::tuple<int, int, int> version = GetMajorMinorPatchTuple();
    reply.mutable_version()->set_major( std::get<0>( version ) );
    reply.mutable_version()->set_minor( std::get<1>( version ) );
    reply.mutable_version()->set_patch( std::get<2>( version ) );

    return reply;
}


HANDLER_RESULT<PathResponse> API_HANDLER_COMMON::handleGetKiCadBinaryPath(
        const HANDLER_CONTEXT<GetKiCadBinaryPath>& aCtx )
{
    wxFileName fn( wxEmptyString, wxString::FromUTF8( aCtx.Request.binary_name() ) );
#ifdef _WIN32
    fn.SetExt( wxT( "exe" ) );
#endif

    wxString path = FindKicadFile( fn.GetFullName() );
    PathResponse reply;
    reply.set_path( path.ToUTF8() );
    return reply;
}


HANDLER_RESULT<NetClassesResponse> API_HANDLER_COMMON::handleGetNetClasses(
        const HANDLER_CONTEXT<GetNetClasses>& aCtx )
{
    NetClassesResponse reply;

    std::shared_ptr<NET_SETTINGS>& netSettings =
            Pgm().GetSettingsManager().Prj().GetProjectFile().m_NetSettings;

    google::protobuf::Any any;

    netSettings->GetDefaultNetclass()->Serialize( any );
    any.UnpackTo( reply.add_net_classes() );

    for( const auto& netClass : netSettings->GetNetclasses() | std::views::values )
    {
        netClass->Serialize( any );
        any.UnpackTo( reply.add_net_classes() );
    }

    return reply;
}


HANDLER_RESULT<Empty> API_HANDLER_COMMON::handleSetNetClasses(
        const HANDLER_CONTEXT<SetNetClasses>& aCtx )
{
    std::shared_ptr<NET_SETTINGS>& netSettings =
            Pgm().GetSettingsManager().Prj().GetProjectFile().m_NetSettings;

    if( aCtx.Request.merge_mode() == MapMergeMode::MMM_REPLACE )
        netSettings->ClearNetclasses();

    auto netClasses = netSettings->GetNetclasses();
    google::protobuf::Any any;

    for( const auto& ncProto : aCtx.Request.net_classes() )
    {
        any.PackFrom( ncProto );
        wxString name = wxString::FromUTF8( ncProto.name() );

        if( name == wxT( "Default" ) )
        {
            netSettings->GetDefaultNetclass()->Deserialize( any );
        }
        else
        {
            if( !netClasses.contains( name ) )
                netClasses.insert( { name, std::make_shared<NETCLASS>( name, false ) } );

            netClasses[name]->Deserialize( any );
        }
    }

    netSettings->SetNetclasses( netClasses );

    return Empty();
}


HANDLER_RESULT<Empty> API_HANDLER_COMMON::handlePing( const HANDLER_CONTEXT<Ping>& aCtx )
{
    return Empty();
}


HANDLER_RESULT<types::Box2> API_HANDLER_COMMON::handleGetTextExtents(
        const HANDLER_CONTEXT<GetTextExtents>& aCtx )
{
    EDA_TEXT text( pcbIUScale );
    google::protobuf::Any any;
    any.PackFrom( aCtx.Request.text() );

    if( !text.Deserialize( any ) )
    {
        ApiResponseStatus e;
        e.set_status( ApiStatusCode::AS_BAD_REQUEST );
        e.set_error_message( "Could not decode text in GetTextExtents message" );
        return tl::unexpected( e );
    }

    types::Box2 response;

    BOX2I bbox = text.GetTextBox( nullptr );
    EDA_ANGLE angle = text.GetTextAngle();

    if( !angle.IsZero() )
        bbox = bbox.GetBoundingBoxRotated( text.GetTextPos(), text.GetTextAngle() );

    response.mutable_position()->set_x_nm( bbox.GetPosition().x );
    response.mutable_position()->set_y_nm( bbox.GetPosition().y );
    response.mutable_size()->set_x_nm( bbox.GetSize().x );
    response.mutable_size()->set_y_nm( bbox.GetSize().y );

    return response;
}


HANDLER_RESULT<GetTextAsShapesResponse> API_HANDLER_COMMON::handleGetTextAsShapes(
        const HANDLER_CONTEXT<GetTextAsShapes>& aCtx )
{
    GetTextAsShapesResponse reply;

    for( const TextOrTextBox& textMsg : aCtx.Request.text() )
    {
        Text dummyText;
        const Text* textPtr = &textMsg.text();

        if( textMsg.has_textbox() )
        {
            dummyText.set_text( textMsg.textbox().text() );
            dummyText.mutable_attributes()->CopyFrom( textMsg.textbox().attributes() );
            textPtr = &dummyText;
        }

        EDA_TEXT text( pcbIUScale );
        google::protobuf::Any any;
        any.PackFrom( *textPtr );

        if( !text.Deserialize( any ) )
        {
            ApiResponseStatus e;
            e.set_status( ApiStatusCode::AS_BAD_REQUEST );
            e.set_error_message( "Could not decode text in GetTextAsShapes message" );
            return tl::unexpected( e );
        }

        std::shared_ptr<SHAPE_COMPOUND> shapes = text.GetEffectiveTextShape( false );

        TextWithShapes* entry = reply.add_text_with_shapes();
        entry->mutable_text()->CopyFrom( textMsg );

        for( SHAPE* subshape : shapes->Shapes() )
        {
            EDA_SHAPE proxy( *subshape );
            proxy.Serialize( any );
            GraphicShape* shapeMsg = entry->mutable_shapes()->add_shapes();
            any.UnpackTo( shapeMsg );
        }

        if( textMsg.has_textbox() )
        {
            GraphicShape* border = entry->mutable_shapes()->add_shapes();
            int width = textMsg.textbox().attributes().stroke_width().value_nm();
            border->mutable_attributes()->mutable_stroke()->mutable_width()->set_value_nm( width );
            VECTOR2I tl = UnpackVector2( textMsg.textbox().top_left() );
            VECTOR2I br = UnpackVector2( textMsg.textbox().bottom_right() );

            // top
            PackVector2( *border->mutable_segment()->mutable_start(), tl );
            PackVector2( *border->mutable_segment()->mutable_end(), VECTOR2I( br.x, tl.y ) );

            // right
            border = entry->mutable_shapes()->add_shapes();
            border->mutable_attributes()->mutable_stroke()->mutable_width()->set_value_nm( width );
            PackVector2( *border->mutable_segment()->mutable_start(), VECTOR2I( br.x, tl.y ) );
            PackVector2( *border->mutable_segment()->mutable_end(), br );

            // bottom
            border = entry->mutable_shapes()->add_shapes();
            border->mutable_attributes()->mutable_stroke()->mutable_width()->set_value_nm( width );
            PackVector2( *border->mutable_segment()->mutable_start(), br );
            PackVector2( *border->mutable_segment()->mutable_end(), VECTOR2I( tl.x, br.y ) );

            // left
            border = entry->mutable_shapes()->add_shapes();
            border->mutable_attributes()->mutable_stroke()->mutable_width()->set_value_nm( width );
            PackVector2( *border->mutable_segment()->mutable_start(), VECTOR2I( tl.x, br.y ) );
            PackVector2( *border->mutable_segment()->mutable_end(), tl );
        }
    }

    return reply;
}


HANDLER_RESULT<ExpandTextVariablesResponse> API_HANDLER_COMMON::handleExpandTextVariables(
        const HANDLER_CONTEXT<ExpandTextVariables>& aCtx )
{
    if( !aCtx.Request.has_document() || aCtx.Request.document().type() != DOCTYPE_PROJECT )
    {
        ApiResponseStatus e;
        e.set_status( ApiStatusCode::AS_UNHANDLED );
        // No error message, this is a flag that the server should try a different handler
        return tl::unexpected( e );
    }

    ExpandTextVariablesResponse reply;
    PROJECT& project = Pgm().GetSettingsManager().Prj();

    for( const std::string& textMsg : aCtx.Request.text() )
    {
        wxString result = ExpandTextVars( wxString::FromUTF8( textMsg ), &project );

        if( aCtx.Request.expand_env_vars() )
            result = ExpandEnvVarSubstitutions( result, &project );

        reply.add_text( result.ToUTF8() );
    }

    return reply;
}


HANDLER_RESULT<StringResponse> API_HANDLER_COMMON::handleGetPluginSettingsPath(
        const HANDLER_CONTEXT<GetPluginSettingsPath>& aCtx )
{
    wxString identifier = wxString::FromUTF8( aCtx.Request.identifier() );

    if( identifier.IsEmpty() )
    {
        ApiResponseStatus e;
        e.set_status( ApiStatusCode::AS_BAD_REQUEST );
        e.set_error_message( "plugin identifier is missing" );
        return tl::unexpected( e );
    }

    if( !API_PLUGIN::IsValidIdentifier( identifier ) )
    {
        ApiResponseStatus e;
        e.set_status( ApiStatusCode::AS_BAD_REQUEST );
        e.set_error_message( "plugin identifier is invalid" );
        return tl::unexpected( e );
    }

    wxFileName path( PATHS::GetUserSettingsPath(), wxEmptyString );
    path.AppendDir( "plugins" );

    // Create the base plugins path if needed, but leave the specific plugin to create its own path
    PATHS::EnsurePathExists( path.GetPath() );

    path.AppendDir( identifier );

    StringResponse reply;
    reply.set_response( path.GetPath() );
    return reply;
}


HANDLER_RESULT<project::TextVariables> API_HANDLER_COMMON::handleGetTextVariables(
        const HANDLER_CONTEXT<GetTextVariables>& aCtx )
{
    if( !aCtx.Request.has_document() || aCtx.Request.document().type() != DOCTYPE_PROJECT )
    {
        ApiResponseStatus e;
        e.set_status( ApiStatusCode::AS_UNHANDLED );
        // No error message, this is a flag that the server should try a different handler
        return tl::unexpected( e );
    }

    const PROJECT& project = Pgm().GetSettingsManager().Prj();

    if( project.IsNullProject() )
    {
        ApiResponseStatus e;
        e.set_status( ApiStatusCode::AS_NOT_READY );
        e.set_error_message( "no valid project is loaded, cannot get text variables" );
        return tl::unexpected( e );
    }

    const std::map<wxString, wxString>& vars = project.GetTextVars();

    project::TextVariables reply;
    auto map = reply.mutable_variables();

    for( const auto& [key, value] : vars )
        ( *map )[ std::string( key.ToUTF8() ) ] = value.ToUTF8();

    return reply;
}


HANDLER_RESULT<Empty> API_HANDLER_COMMON::handleSetTextVariables(
    const HANDLER_CONTEXT<SetTextVariables>& aCtx )
{
    if( !aCtx.Request.has_document() || aCtx.Request.document().type() != DOCTYPE_PROJECT )
    {
        ApiResponseStatus e;
        e.set_status( ApiStatusCode::AS_UNHANDLED );
        // No error message, this is a flag that the server should try a different handler
        return tl::unexpected( e );
    }

    PROJECT& project = Pgm().GetSettingsManager().Prj();

    if( project.IsNullProject() )
    {
        ApiResponseStatus e;
        e.set_status( ApiStatusCode::AS_NOT_READY );
        e.set_error_message( "no valid project is loaded, cannot set text variables" );
        return tl::unexpected( e );
    }

    const project::TextVariables& newVars = aCtx.Request.variables();
    std::map<wxString, wxString>& vars = project.GetTextVars();

    if( aCtx.Request.merge_mode() == MapMergeMode::MMM_REPLACE )
        vars.clear();

    for( const auto& [key, value] : newVars.variables() )
        vars[wxString::FromUTF8( key )] = wxString::FromUTF8( value );

    Pgm().GetSettingsManager().SaveProject();

    return Empty();
}


HANDLER_RESULT<OpenDocumentResponse> API_HANDLER_COMMON::handleOpenDocument(
        const HANDLER_CONTEXT<OpenDocument>& aCtx )
{
    if( !m_openDocumentHandler )
    {
        ApiResponseStatus e;
        e.set_status( ApiStatusCode::AS_UNIMPLEMENTED );
        e.set_error_message( "OpenDocument is not available in this KiCad mode" );
        return tl::unexpected( e );
    }

    return m_openDocumentHandler( aCtx.Request );
}


HANDLER_RESULT<Empty> API_HANDLER_COMMON::handleCloseDocument(
        const HANDLER_CONTEXT<CloseDocument>& aCtx )
{
    if( !m_closeDocumentHandler )
    {
        ApiResponseStatus e;
        e.set_status( ApiStatusCode::AS_UNIMPLEMENTED );
        e.set_error_message( "CloseDocument is not available in this KiCad mode" );
        return tl::unexpected( e );
    }

    return m_closeDocumentHandler( aCtx.Request );
}


HANDLER_RESULT<OpenDocumentResponse>
API_HANDLER_COMMON::handleCreateDocument( const HANDLER_CONTEXT<CreateDocument>& aCtx )
{
    if( !m_createDocumentHandler )
    {
        ApiResponseStatus e;
        e.set_status( ApiStatusCode::AS_UNIMPLEMENTED );
        e.set_error_message( "CreateDocument is not available in this KiCad mode" );
        return tl::unexpected( e );
    }

    return m_createDocumentHandler( aCtx.Request );
}


HANDLER_RESULT<Empty> API_HANDLER_COMMON::handleCloseAllDocuments( const HANDLER_CONTEXT<CloseAllDocuments>& aCtx )
{
    if( !m_closeAllDocumentsHandler )
    {
        ApiResponseStatus e;
        e.set_status( ApiStatusCode::AS_UNIMPLEMENTED );
        e.set_error_message( "CloseAllDocuments is not available in this KiCad mode" );
        return tl::unexpected( e );
    }

    return m_closeAllDocumentsHandler( aCtx.Request );
}


HANDLER_RESULT<GetPathsResponse> API_HANDLER_COMMON::handleGetPaths( const HANDLER_CONTEXT<GetPaths>& )
{
    GetPathsResponse reply;

    auto addPath = [&]( types::PathType aType, const wxString& aPath )
    {
        PathEntry* entry = reply.add_paths();
        entry->set_type( aType );
        entry->set_path( aPath.ToUTF8() );
    };

    addPath( types::PATH_USER_PLUGINS, PATHS::GetUserPluginsPath() );
    addPath( types::PATH_USER_TEMPLATES, PATHS::GetUserTemplatesPath() );
    addPath( types::PATH_USER_SETTINGS, PATHS::GetUserSettingsPath() );
    addPath( types::PATH_STOCK_SYMBOLS, PATHS::GetStockSymbolsPath() );
    addPath( types::PATH_STOCK_FOOTPRINTS, PATHS::GetStockFootprintsPath() );
    addPath( types::PATH_STOCK_DESIGN_BLOCKS, PATHS::GetStockDesignBlocksPath() );
    addPath( types::PATH_STOCK_3DMODELS, PATHS::GetStock3dmodelsPath() );
    addPath( types::PATH_STOCK_TEMPLATES, PATHS::GetStockTemplatesPath() );

    return reply;
}


HANDLER_RESULT<GetCapabilitiesResponse> API_HANDLER_COMMON::handleGetCapabilities(
        const HANDLER_CONTEXT<GetCapabilities>& )
{
    GetCapabilitiesResponse reply;

    // A dedicated, semver-comparable API version.  GetBuildVersion() includes
    // the git describe suffix (10.99.0-3834-g...), which no client can compare
    // against the "since" values below.
    reply.set_api_version( "11.0" );

    KICAD_API_SERVER* server = m_apiServer ? m_apiServer : Pgm().ApiServerOrNull();

    auto add = [&]( const char* aId, const char* aLayer, const char* aRequest,
                    const char* aResponse, const char* aCli, bool aExperimental,
                    const char* aDescription )
    {
        // Only advertise commands that the handlers actually registered for this
        // session.  CLI-only capabilities have no request type and are always
        // listed (the kicad-cli binary provides them).
        if( server && aRequest && aRequest[0] != '\0'
            && !server->SupportsRequestType( aRequest ) )
        {
            return;
        }

        Capability* cap = reply.add_capabilities();
        cap->set_id( aId );
        cap->set_layer( aLayer );
        cap->set_request_type( aRequest );
        cap->set_response_type( aResponse );
        cap->set_cli_command( aCli );
        cap->set_experimental( aExperimental );
        cap->set_since( "11.0" );
        cap->set_description( aDescription );
    };

    // Common API
    add( "common.version", "api", "kiapi.common.commands.GetVersion",
         "kiapi.common.commands.GetVersionResponse", "", false,
         "Return the KiCad build version" );
    add( "common.ping", "api", "kiapi.common.commands.Ping", "google.protobuf.Empty", "",
         false, "Liveness check" );
    add( "common.paths", "api", "kiapi.common.commands.GetPaths",
         "kiapi.common.commands.GetPathsResponse", "", false,
         "Return well-known KiCad filesystem paths" );
    add( "common.capabilities", "api", "kiapi.common.commands.GetCapabilities",
         "kiapi.common.commands.GetCapabilitiesResponse", "", false,
         "Enumerate automation capabilities (this command)" );
    add( "common.jobs.status", "api", "kiapi.common.commands.GetJobStatus",
         "kiapi.common.commands.JobStatusResponse", "", false,
         "Return the state and timing of a dispatched job" );
    add( "common.jobs.cancel", "api", "kiapi.common.commands.CancelJob",
         "kiapi.common.commands.CancelJobResponse", "", false,
         "Request cooperative cancellation of a running job" );

    // Editor item model and document persistence
    add( "common.items.create", "api", "kiapi.common.commands.CreateItems",
         "kiapi.common.commands.CreateItemsResponse", "", false,
         "Create items from serialized protobuf messages" );
    add( "common.items.update", "api", "kiapi.common.commands.UpdateItems",
         "kiapi.common.commands.UpdateItemsResponse", "", false,
         "Update items by KIID" );
    add( "common.items.delete", "api", "kiapi.common.commands.DeleteItems",
         "kiapi.common.commands.DeleteItemsResponse", "", false,
         "Delete items by KIID" );
    add( "common.items.get", "api", "kiapi.common.commands.GetItems",
         "kiapi.common.commands.GetItemsResponse", "", false,
         "Enumerate items by type" );
    add( "common.document.save", "api", "kiapi.common.commands.SaveDocument",
         "google.protobuf.Empty", "", false, "Save the active document" );
    add( "common.document.save_to_string", "api",
         "kiapi.common.commands.SaveDocumentToString",
         "kiapi.common.commands.SavedDocumentResponse", "", false,
         "Serialize the active document to s-expression text" );

    // Board-specific
    add( "board.stackup.read", "api", "kiapi.board.commands.GetBoardStackup",
         "kiapi.board.commands.BoardStackupResponse", "", false,
         "Read the board stackup" );
    add( "board.stackup.write", "api", "kiapi.board.commands.UpdateBoardStackup",
         "kiapi.board.commands.BoardStackupResponse", "", false,
         "Update stackup thicknesses and dielectric properties (layer count is fixed)" );
    add( "board.nets.read", "api", "kiapi.board.commands.GetNets",
         "kiapi.board.commands.NetsResponse", "", false, "Enumerate board nets" );
    add( "board.zones.refill", "api", "kiapi.board.commands.RefillZones",
         "google.protobuf.Empty", "", false, "Refill copper zones" );
    add( "board.netlist.import", "api", "kiapi.board.commands.ImportNetlist",
         "kiapi.board.commands.ImportNetlistResponse", "", false,
         "Import a netlist and update footprints" );
    add( "board.connectivity.prove", "api", "kiapi.board.commands.ProveConnectivity",
         "kiapi.board.commands.ConnectivityProof", "", false,
         "Prove pad/via connections including filled zones and inner-layer planes" );
    add( "board.place.autoplace", "api", "kiapi.board.commands.AutoPlaceFootprints",
         "kiapi.board.commands.AutoPlaceFootprintsResponse", "", false,
         "Automatically place footprints using KiCad's autoplacer" );
    add( "board.plane.create", "api", "kiapi.board.commands.CreatePlane",
         "kiapi.board.commands.CreatePlaneResponse", "", false,
         "Create a net-bound copper zone on inner layers" );
    add( "board.plane.verify", "api", "kiapi.board.commands.VerifyPlane",
         "kiapi.board.commands.VerifyPlaneResponse", "", false,
         "Verify a plane's fill and pad/via connectivity" );
    add( "board.drc.run", "cli", "", "", "pcb drc", false,
         "Run design rule checks (supports --timeout)" );

    // Schematic-specific
    add( "schematic.netlist.get", "api", "kiapi.schematic.commands.GetSchematicNetlist",
         "kiapi.schematic.commands.SchematicNetlistResponse", "", false,
         "Return the schematic connectivity-derived netlist" );
    add( "schematic.create", "api", "kiapi.common.commands.CreateDocument",
         "kiapi.common.commands.OpenDocumentResponse", "", false,
         "Create an empty schematic document (headless API server)" );
    add( "library.search.symbols", "api",
         "kiapi.schematic.commands.SearchLibrarySymbolsRequest",
         "kiapi.schematic.commands.SearchLibrarySymbolsResponse", "", false,
         "Search symbol libraries by name, description, keywords, and pin count" );
    add( "library.get.symbol", "api", "kiapi.schematic.commands.GetLibrarySymbolRequest",
         "kiapi.schematic.commands.GetLibrarySymbolResponse", "", false,
         "Load a symbol's embedded definition and pins" );
    add( "schematic.place.symbol", "api",
         "kiapi.schematic.commands.PlaceSymbolFromLibraryRequest",
         "kiapi.schematic.commands.PlaceSymbolFromLibraryResponse", "", false,
         "Place a symbol from a library and return absolute pin positions" );
    add( "schematic.annotate", "api",
         "kiapi.schematic.commands.AnnotateSchematicRequest",
         "kiapi.schematic.commands.AnnotateSchematicResponse", "", false,
         "Annotate schematic reference designators" );
    add( "schematic.jobs.export.svg", "api",
         "kiapi.schematic.jobs.RunSchematicJobExportSvg",
         "kiapi.common.types.RunJobResponse", "sch export svg", false,
         "Export a schematic to SVG" );
    add( "schematic.jobs.export.dxf", "api",
         "kiapi.schematic.jobs.RunSchematicJobExportDxf",
         "kiapi.common.types.RunJobResponse", "sch export dxf", false,
         "Export a schematic to DXF" );
    add( "schematic.jobs.export.pdf", "api",
         "kiapi.schematic.jobs.RunSchematicJobExportPdf",
         "kiapi.common.types.RunJobResponse", "sch export pdf", false,
         "Export a schematic to PDF" );
    add( "schematic.jobs.export.ps", "api",
         "kiapi.schematic.jobs.RunSchematicJobExportPs",
         "kiapi.common.types.RunJobResponse", "sch export ps", false,
         "Export a schematic to PostScript" );
    add( "schematic.jobs.export.netlist", "api",
         "kiapi.schematic.jobs.RunSchematicJobExportNetlist",
         "kiapi.common.types.RunJobResponse", "sch export netlist", false,
         "Export a schematic netlist" );
    add( "schematic.jobs.export.bom", "api",
         "kiapi.schematic.jobs.RunSchematicJobExportBOM",
         "kiapi.common.types.RunJobResponse", "sch export bom", false,
         "Export a schematic BOM" );
    add( "schematic.erc.run", "cli", "", "", "sch erc", false,
         "Run electrical rules checks (supports --timeout)" );

    return reply;
}

HANDLER_RESULT<commands::JobStatusResponse> API_HANDLER_COMMON::handleGetJobStatus(
        const HANDLER_CONTEXT<commands::GetJobStatus>& aCtx )
{
    JOB_INSTANCE_INFO info;

    if( !JOB_STATUS_REGISTRY::Get( wxString::FromUTF8( aCtx.Request.job_id() ), info ) )
    {
        ApiResponseStatus e;
        e.set_status( ApiStatusCode::AS_BAD_REQUEST );
        e.set_error_message( fmt::format( "unknown job id '{}'", aCtx.Request.job_id() ) );
        return tl::unexpected( e );
    }

    commands::JobStatusResponse response;
    response.set_job_id( aCtx.Request.job_id() );
    response.set_status( static_cast<kiapi::common::types::JobStatus>( info.status ) );
    response.set_elapsed_ms( info.elapsedMs );
    response.set_message( info.message.ToStdString() );

    return response;
}


HANDLER_RESULT<commands::CancelJobResponse> API_HANDLER_COMMON::handleCancelJob(
        const HANDLER_CONTEXT<commands::CancelJob>& aCtx )
{
    const wxString jobId = wxString::FromUTF8( aCtx.Request.job_id() );
    JOB_INSTANCE_INFO info;

    if( !JOB_STATUS_REGISTRY::Get( jobId, info ) )
    {
        ApiResponseStatus e;
        e.set_status( ApiStatusCode::AS_BAD_REQUEST );
        e.set_error_message( fmt::format( "unknown job id '{}'", aCtx.Request.job_id() ) );
        return tl::unexpected( e );
    }

    const bool requested = JOB_STATUS_REGISTRY::Cancel( jobId );

    commands::CancelJobResponse response;
    response.set_job_id( aCtx.Request.job_id() );
    response.set_cancel_requested( requested );

    if( requested )
        response.set_message( "Cancel requested" );
    else if( info.running )
        response.set_message( "Job is already finishing" );
    else
        response.set_message( "Job has already finished" );

    return response;
}
