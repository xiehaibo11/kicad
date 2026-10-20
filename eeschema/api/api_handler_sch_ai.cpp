/*
 * This program source code file is part of KiCad, a free EDA CAD application.
 *
 * Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.
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

#include <api/api_handler_sch_ai.h>

#include <algorithm>
#include <set>

#include <api/api_enums.h>
#include <api/api_sch_utils.h>
#include <api/api_utils.h>
#include <base_units.h>
#include <fmt.h>
#include <libraries/symbol_library_adapter.h>
#include <lib_symbol.h>
#include <project_sch.h>
#include <refdes_tracker.h>
#include <sch_commit.h>
#include <sch_field.h>
#include <sch_pin.h>
#include <sch_reference_list.h>
#include <sch_screen.h>
#include <sch_sheet_path.h>
#include <sch_symbol.h>
#include <schematic.h>

namespace ksc = kiapi::schematic::commands;
namespace kst = kiapi::schematic::types;
namespace kct = kiapi::common::types;

static LIB_ID libIdFromProto( const kct::LibraryIdentifier& aId )
{
    LIB_ID id;
    wxString full = wxString::FromUTF8( aId.library_nickname() );

    if( !aId.entry_name().empty() )
        full += wxT( ":" ) + wxString::FromUTF8( aId.entry_name() );

    id.Parse( full );
    return id;
}

static void packPin( ksc::LibrarySymbolPin* aOut, const SCH_PIN* aPin )
{
    aOut->set_number( aPin->GetNumber().ToStdString() );
    aOut->set_name( aPin->GetName().ToStdString() );
    aOut->set_electrical_type(
            ToProtoEnum<ELECTRICAL_PINTYPE, kct::ElectricalPinType>( aPin->GetType() ) );
}

API_HANDLER_SCH_AI::API_HANDLER_SCH_AI( SCH_EDIT_FRAME* aFrame ) :
        API_HANDLER_SCH( aFrame )
{
    registerHandler<ksc::SearchLibrarySymbolsRequest, ksc::SearchLibrarySymbolsResponse>(
            &API_HANDLER_SCH_AI::handleSearchLibrarySymbols );
    registerHandler<ksc::GetLibrarySymbolRequest, ksc::GetLibrarySymbolResponse>(
            &API_HANDLER_SCH_AI::handleGetLibrarySymbol );
    registerHandler<ksc::PlaceSymbolFromLibraryRequest, ksc::PlaceSymbolFromLibraryResponse>(
            &API_HANDLER_SCH_AI::handlePlaceSymbolFromLibrary );
    registerHandler<ksc::AnnotateSchematicRequest, ksc::AnnotateSchematicResponse>(
            &API_HANDLER_SCH_AI::handleAnnotateSchematic );
}


API_HANDLER_SCH_AI::API_HANDLER_SCH_AI( std::shared_ptr<SCH_CONTEXT> aContext,
                                        SCH_EDIT_FRAME* aFrame ) :
        API_HANDLER_SCH( std::move( aContext ), aFrame )
{
    registerHandler<ksc::SearchLibrarySymbolsRequest, ksc::SearchLibrarySymbolsResponse>(
            &API_HANDLER_SCH_AI::handleSearchLibrarySymbols );
    registerHandler<ksc::GetLibrarySymbolRequest, ksc::GetLibrarySymbolResponse>(
            &API_HANDLER_SCH_AI::handleGetLibrarySymbol );
    registerHandler<ksc::PlaceSymbolFromLibraryRequest, ksc::PlaceSymbolFromLibraryResponse>(
            &API_HANDLER_SCH_AI::handlePlaceSymbolFromLibrary );
    registerHandler<ksc::AnnotateSchematicRequest, ksc::AnnotateSchematicResponse>(
            &API_HANDLER_SCH_AI::handleAnnotateSchematic );
}


HANDLER_RESULT<ksc::SearchLibrarySymbolsResponse>
API_HANDLER_SCH_AI::handleSearchLibrarySymbols(
        const HANDLER_CONTEXT<ksc::SearchLibrarySymbolsRequest>& aCtx )
{
    SYMBOL_LIBRARY_ADAPTER* adapter = PROJECT_SCH::SymbolLibAdapter( &project() );

    if( !adapter )
    {
        ApiResponseStatus e;
        e.set_status( ApiStatusCode::AS_UNKNOWN );
        e.set_error_message( "symbol library adapter is unavailable" );
        return tl::unexpected( e );
    }

    const wxString libraryFilter = wxString::FromUTF8( aCtx.Request.library() );
    const wxString query = wxString::FromUTF8( aCtx.Request.query() ).Lower();

    std::vector<wxString> keywords;

    for( const std::string& keyword : aCtx.Request.keywords() )
        keywords.push_back( wxString::FromUTF8( keyword ).Lower() );

    const uint32_t limit = aCtx.Request.limit();

    ksc::SearchLibrarySymbolsResponse response;

    // GetLibraryNames() only reports already-loaded libraries.  Enumerate the
    // library table instead and load each nickname before asking for symbols.
    for( LIBRARY_TABLE_ROW* row : adapter->Rows() )
    {
        if( !row )
            continue;

        const wxString nickname = row->Nickname();

        if( !libraryFilter.empty() && nickname != libraryFilter )
            continue;

        try
        {
            adapter->LoadOne( nickname );
        }
        catch( const IO_ERROR& )
        {
            continue;
        }

        std::vector<LIB_SYMBOL*> symbols = adapter->GetSymbols( nickname );

        for( LIB_SYMBOL* libSymbol : symbols )
        {
            if( !libSymbol )
                continue;

            const int pinCount = libSymbol->GetPinCount();

            if( aCtx.Request.min_pins() > 0
                && static_cast<uint32_t>( pinCount ) < aCtx.Request.min_pins() )
                continue;

            if( aCtx.Request.max_pins() > 0
                && static_cast<uint32_t>( pinCount ) > aCtx.Request.max_pins() )
                continue;

            const wxString haystack = libSymbol->GetName() + wxT( " " )
                                      + libSymbol->GetDescription() + wxT( " " )
                                      + libSymbol->GetKeywordsProp();
            const wxString lowered = haystack.Lower();

            if( !query.empty() && lowered.Find( query ) == wxNOT_FOUND )
                continue;

            bool allKeywords = true;

            for( const wxString& keyword : keywords )
            {
                if( lowered.Find( keyword ) == wxNOT_FOUND )
                {
                    allKeywords = false;
                    break;
                }
            }

            if( !allKeywords )
                continue;

            ksc::LibrarySymbolInfo* info = response.add_symbols();

            info->mutable_id()->set_library_nickname( nickname.ToStdString() );
            info->mutable_id()->set_entry_name( libSymbol->GetName().ToStdString() );
            info->set_name( libSymbol->GetName().ToStdString() );
            info->set_description( libSymbol->GetDescription().ToStdString() );
            info->set_keywords( libSymbol->GetKeywordsProp().ToStdString() );
            info->set_unit_count( libSymbol->GetUnitCount() );
            info->set_pin_count( pinCount );

            for( SCH_PIN* pin : libSymbol->GetPins() )
                packPin( info->add_pins(), pin );

            if( limit > 0 && static_cast<uint32_t>( response.symbols_size() ) >= limit )
                return response;
        }
    }

    return response;
}


HANDLER_RESULT<ksc::GetLibrarySymbolResponse> API_HANDLER_SCH_AI::handleGetLibrarySymbol(
        const HANDLER_CONTEXT<ksc::GetLibrarySymbolRequest>& aCtx )
{
    SYMBOL_LIBRARY_ADAPTER* adapter = PROJECT_SCH::SymbolLibAdapter( &project() );

    if( !adapter )
    {
        ApiResponseStatus e;
        e.set_status( ApiStatusCode::AS_UNKNOWN );
        e.set_error_message( "symbol library adapter is unavailable" );
        return tl::unexpected( e );
    }

    const LIB_ID libId = libIdFromProto( aCtx.Request.id() );
    LIB_SYMBOL* libSymbol = nullptr;

    try
    {
        adapter->LoadOne( libId.GetLibNickname() );
        libSymbol = adapter->LoadSymbol( libId );
    }
    catch( const IO_ERROR& e )
    {
        ApiResponseStatus status;
        status.set_status( ApiStatusCode::AS_BAD_REQUEST );
        status.set_error_message( e.What().ToStdString() );
        return tl::unexpected( status );
    }

    if( !libSymbol )
    {
        ApiResponseStatus e;
        e.set_status( ApiStatusCode::AS_BAD_REQUEST );
        e.set_error_message( fmt::format( "symbol '{}' not found",
                                          libId.Format().c_str() ) );
        return tl::unexpected( e );
    }

    SCHEMATIC* schematic = context()->GetSchematic();

    if( !schematic )
    {
        ApiResponseStatus e;
        e.set_status( ApiStatusCode::AS_UNKNOWN );
        e.set_error_message( "no schematic is open" );
        return tl::unexpected( e );
    }

    SCH_SHEET_PATH& sheetPath = schematic->CurrentSheet();

    // Build a temporary placed symbol so PackSymbol can emit the complete
    // embedded definition, including units and body styles.
    SCH_SYMBOL temp( *libSymbol, libId, &sheetPath, 1, BODY_STYLE::BASE );

    kst::SchematicSymbolInstance packed;

    if( !PackSymbol( &packed, &temp, sheetPath ) )
    {
        ApiResponseStatus e;
        e.set_status( ApiStatusCode::AS_UNKNOWN );
        e.set_error_message( "failed to serialize the library symbol" );
        return tl::unexpected( e );
    }

    ksc::GetLibrarySymbolResponse response;
    response.mutable_definition()->CopyFrom( packed.definition() );

    for( SCH_PIN* pin : libSymbol->GetPins() )
        packPin( response.add_pins(), pin );

    return response;
}


HANDLER_RESULT<ksc::PlaceSymbolFromLibraryResponse>
API_HANDLER_SCH_AI::handlePlaceSymbolFromLibrary(
        const HANDLER_CONTEXT<ksc::PlaceSymbolFromLibraryRequest>& aCtx )
{
    if( std::optional<ApiResponseStatus> busy = checkForBusy() )
        return tl::unexpected( *busy );

    HANDLER_RESULT<bool> documentValidation = validateDocument( aCtx.Request.schematic() );

    if( !documentValidation )
        return tl::unexpected( documentValidation.error() );

    SYMBOL_LIBRARY_ADAPTER* adapter = PROJECT_SCH::SymbolLibAdapter( &project() );

    if( !adapter )
    {
        ApiResponseStatus e;
        e.set_status( ApiStatusCode::AS_UNKNOWN );
        e.set_error_message( "symbol library adapter is unavailable" );
        return tl::unexpected( e );
    }

    SCHEMATIC* schematic = context()->GetSchematic();

    if( !schematic )
    {
        ApiResponseStatus e;
        e.set_status( ApiStatusCode::AS_UNKNOWN );
        e.set_error_message( "no schematic is open" );
        return tl::unexpected( e );
    }

    SCH_SCREEN* screen = schematic->GetCurrentScreen();

    if( !screen )
    {
        ApiResponseStatus e;
        e.set_status( ApiStatusCode::AS_UNKNOWN );
        e.set_error_message( "no schematic screen is open" );
        return tl::unexpected( e );
    }

    const LIB_ID libId = libIdFromProto( aCtx.Request.id() );
    LIB_SYMBOL* libSymbol = nullptr;

    try
    {
        adapter->LoadOne( libId.GetLibNickname() );
        libSymbol = adapter->LoadSymbol( libId );
    }
    catch( const IO_ERROR& e )
    {
        ApiResponseStatus status;
        status.set_status( ApiStatusCode::AS_BAD_REQUEST );
        status.set_error_message( e.What().ToStdString() );
        return tl::unexpected( status );
    }

    if( !libSymbol )
    {
        ApiResponseStatus e;
        e.set_status( ApiStatusCode::AS_BAD_REQUEST );
        e.set_error_message( fmt::format( "symbol '{}' not found",
                                          libId.Format().c_str() ) );
        return tl::unexpected( e );
    }

    SCH_SHEET_PATH& sheetPath = schematic->CurrentSheet();
    const int       unit = aCtx.Request.unit() > 0 ? aCtx.Request.unit() : 1;
    const int       unitCount = std::max( libSymbol->GetUnitCount(), 1 );

    if( unit < 1 || unit > unitCount )
    {
        ApiResponseStatus e;
        e.set_status( ApiStatusCode::AS_BAD_REQUEST );
        e.set_error_message( fmt::format( "unit {} is out of range (symbol has {} units)",
                                          unit, unitCount ) );
        return tl::unexpected( e );
    }

    SCH_SYMBOL* symbol = new SCH_SYMBOL( *libSymbol, libId, &sheetPath, unit,
                                        BODY_STYLE::BASE,
                                        UnpackVector2( aCtx.Request.position(), schIUScale ),
                                        screen );

    if( !aCtx.Request.reference().empty() )
        symbol->SetRef( &sheetPath, wxString::FromUTF8( aCtx.Request.reference() ) );

    if( !aCtx.Request.value().empty() )
        symbol->SetValueFieldText( wxString::FromUTF8( aCtx.Request.value() ), &sheetPath );

    if( !aCtx.Request.footprint().empty() )
    {
        symbol->SetFieldText( wxT( "Footprint" ),
                              wxString::FromUTF8( aCtx.Request.footprint() ), &sheetPath );
    }

    kst::SchematicSymbolInstance packed;

    if( !PackSymbol( &packed, symbol, sheetPath ) )
    {
        delete symbol;

        ApiResponseStatus e;
        e.set_status( ApiStatusCode::AS_UNKNOWN );
        e.set_error_message( "failed to serialize the placed symbol" );
        return tl::unexpected( e );
    }

    std::unique_ptr<COMMIT> commit = createCommit();
    commit->Add( symbol, screen );
    commit->Push( _( "Place symbol from library" ) );

    ksc::PlaceSymbolFromLibraryResponse response;
    response.mutable_item()->set_value( symbol->m_Uuid.AsStdString() );
    response.mutable_symbol()->CopyFrom( packed );

    for( SCH_PIN* pin : symbol->GetPins( &sheetPath ) )
    {
        ksc::PlacedSymbolPin* out = response.add_pins();
        out->set_number( pin->GetNumber().ToStdString() );
        out->set_name( pin->GetName().ToStdString() );

        // Pin positions are schematic IU; pack them as nanometers for the wire
        // format so clients can round-trip them into labels.
        PackVector2( *out->mutable_position(), pin->GetPosition(), schIUScale );
    }

    return response;
}


HANDLER_RESULT<ksc::AnnotateSchematicResponse> API_HANDLER_SCH_AI::handleAnnotateSchematic(
        const HANDLER_CONTEXT<ksc::AnnotateSchematicRequest>& aCtx )
{
    if( std::optional<ApiResponseStatus> busy = checkForBusy() )
        return tl::unexpected( *busy );

    HANDLER_RESULT<bool> documentValidation = validateDocument( aCtx.Request.schematic() );

    if( !documentValidation )
        return tl::unexpected( documentValidation.error() );

    SCHEMATIC* schematic = context()->GetSchematic();

    if( !schematic )
    {
        ApiResponseStatus e;
        e.set_status( ApiStatusCode::AS_UNKNOWN );
        e.set_error_message( "no schematic is open" );
        return tl::unexpected( e );
    }

    schematic->SetSheetNumberAndCount();

    if( !schematic->Settings().m_refDesTracker )
        schematic->Settings().m_refDesTracker = std::make_shared<REFDES_TRACKER>();

    SCH_REFERENCE_LIST references;
    schematic->Hierarchy().GetSymbols( references, SYMBOL_FILTER_ALL );
    references.SetRefDesTracker( schematic->Settings().m_refDesTracker );

    if( aCtx.Request.reset() )
        references.RemoveAnnotation();

    references.SplitReferences();

    SCH_MULTI_UNIT_REFERENCE_MAP locked;
    SCH_REFERENCE_LIST             additional;

    // SCH_REFERENCE_LIST::Annotate() numbers from aStartNumber + 1, while the
    // API field is documented as the first reference number.
    const int start = std::max( aCtx.Request.start() - 1, 0 );

    int sheetInterval = aCtx.Request.sheet_interval();

    if( aCtx.Request.use_sheet_number() && sheetInterval <= 0 )
        sheetInterval = 100;

    references.SortByXCoordinate();
    references.Annotate( aCtx.Request.use_sheet_number(), sheetInterval,
                         start, locked, additional );

    std::unique_ptr<COMMIT> commit = createCommit();

    for( size_t i = 0; i < references.GetCount(); ++i )
    {
        if( SCH_SYMBOL* symbol = references[i].GetSymbol() )
        {
            if( SCH_SCREEN* symScreen = dynamic_cast<SCH_SCREEN*>( symbol->GetParent() ) )
                commit->Modify( symbol, symScreen );
        }
    }

    references.UpdateAnnotation();
    schematic->CurrentSheet().UpdateAllScreenReferences();
    commit->Push( _( "Annotate schematic" ) );

    ksc::AnnotateSchematicResponse response;
    std::set<std::string>        seen;

    for( size_t i = 0; i < references.GetCount(); ++i )
    {
        SCH_SYMBOL* symbol = references[i].GetSymbol();

        if( !symbol )
            continue;

        const std::string reference =
                symbol->GetRef( &references[i].GetSheetPath() ).ToStdString();
        const std::string uuid = symbol->m_Uuid.AsStdString();

        if( !seen.insert( uuid + "|" + reference ).second )
            continue;

        ksc::AnnotationEntry* entry = response.add_annotations();
        entry->mutable_item()->set_value( uuid );
        entry->set_reference( reference );
    }

    return response;
}
