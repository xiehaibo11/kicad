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

#include <api/api_handler_pcb_ai.h>

#include <cmath>
#include <limits>

#include <api/api_enums.h>
#include <api/api_utils.h>
#include <autorouter/ar_autoplacer.h>
#include <board_commit.h>
#include <board_design_settings.h>
#include <connectivity/connectivity_proof.h>
#include <fmt.h>
#include <footprint.h>
#include <geometry/shape_line_chain.h>
#include <geometry/shape_poly_set.h>
#include <math/box2.h>
#include <netinfo.h>
#include <zone.h>
#include <zone_filler.h>

namespace kbc = kiapi::board::commands;
namespace kct = kiapi::common::types;

static kbc::PlaneInfo makePlaneInfo( BOARD* aBoard, ZONE* aZone )
{
    kbc::PlaneInfo info;

    info.mutable_zone()->set_value( aZone->m_Uuid.AsStdString() );
    info.set_net( aZone->GetNetname().ToStdString() );

    bool     allFilled = aZone->GetLayerSet().count() > 0;
    uint64_t area = 0;

    for( PCB_LAYER_ID layer : aZone->GetLayerSet().Seq() )
    {
        info.add_layers(
                ToProtoEnum<PCB_LAYER_ID, kiapi::board::types::BoardLayer>( layer ) );

        SHAPE_POLY_SET* fill = aZone->GetFill( layer );

        if( !fill || fill->OutlineCount() == 0 )
            allFilled = false;
        else
            area += static_cast<uint64_t>( fill->Area() );
    }

    info.set_filled( aZone->IsFilled() );
    info.set_has_filled_polygons( allFilled );
    info.set_filled_area_nm2( area );

    CONNECTIVITY_PROOF proof( aBoard );

    if( proof.Build() )
    {
        std::vector<CONNECTIVITY_ENDPOINT> endpoints = proof.Prove( {}, true );

        for( const CONNECTIVITY_ENDPOINT& endpoint : endpoints )
        {
            bool connectedToZone = false;

            for( const KIID& zoneId : endpoint.zoneIslands )
            {
                if( zoneId == aZone->m_Uuid )
                {
                    connectedToZone = true;
                    break;
                }
            }

            if( !connectedToZone )
                continue;

            if( endpoint.itemType == wxT( "pad" ) )
                info.set_connected_pads( info.connected_pads() + 1 );
            else if( endpoint.itemType == wxT( "via" ) )
                info.set_connected_vias( info.connected_vias() + 1 );
        }
    }

    return info;
}

API_HANDLER_PCB_AI::API_HANDLER_PCB_AI( PCB_EDIT_FRAME* aFrame ) :
        API_HANDLER_PCB( aFrame )
{
    registerHandler<kbc::AutoPlaceFootprints, kbc::AutoPlaceFootprintsResponse>(
            &API_HANDLER_PCB_AI::handleAutoPlaceFootprints );

    registerHandler<kbc::CreatePlane, kbc::CreatePlaneResponse>(
            &API_HANDLER_PCB_AI::handleCreatePlane );

    registerHandler<kbc::VerifyPlane, kbc::VerifyPlaneResponse>(
            &API_HANDLER_PCB_AI::handleVerifyPlane );
}


API_HANDLER_PCB_AI::API_HANDLER_PCB_AI( std::shared_ptr<PCB_CONTEXT> aContext,
                                        PCB_EDIT_FRAME* aFrame ) :
        API_HANDLER_PCB( std::move( aContext ), aFrame )
{
    registerHandler<kbc::AutoPlaceFootprints, kbc::AutoPlaceFootprintsResponse>(
            &API_HANDLER_PCB_AI::handleAutoPlaceFootprints );

    registerHandler<kbc::CreatePlane, kbc::CreatePlaneResponse>(
            &API_HANDLER_PCB_AI::handleCreatePlane );

    registerHandler<kbc::VerifyPlane, kbc::VerifyPlaneResponse>(
            &API_HANDLER_PCB_AI::handleVerifyPlane );
}


HANDLER_RESULT<kbc::AutoPlaceFootprintsResponse> API_HANDLER_PCB_AI::handleAutoPlaceFootprints(
        const HANDLER_CONTEXT<kbc::AutoPlaceFootprints>& aCtx )
{
    if( std::optional<ApiResponseStatus> busy = checkForBusy() )
        return tl::unexpected( *busy );

    HANDLER_RESULT<bool> documentValidation = validateDocument( aCtx.Request.board() );

    if( !documentValidation )
        return tl::unexpected( documentValidation.error() );

    BOARD* brd = board();

    std::vector<FOOTPRINT*> footprints;

    if( aCtx.Request.footprints_size() > 0 )
    {
        for( const kct::KIID& id : aCtx.Request.footprints() )
        {
            std::optional<BOARD_ITEM*> item = getItemById( ::KIID( id.value() ) );

            if( !item || ( *item )->Type() != PCB_FOOTPRINT_T )
            {
                ApiResponseStatus e;
                e.set_status( ApiStatusCode::AS_BAD_REQUEST );
                e.set_error_message( fmt::format( "footprint '{}' not found on the board",
                                                  id.value() ) );
                return tl::unexpected( e );
            }

            footprints.push_back( static_cast<FOOTPRINT*>( *item ) );
        }
    }
    else
    {
        for( FOOTPRINT* footprint : brd->Footprints() )
            footprints.push_back( footprint );
    }

    // Locked footprints are never moved by the GUI autoplace tool, so honor
    // the lock in headless mode as well and report them as skipped.
    std::vector<FOOTPRINT*> movable;
    kbc::AutoPlaceFootprintsResponse response;

    for( FOOTPRINT* footprint : footprints )
    {
        if( footprint->IsLocked() )
            response.add_skipped( footprint->GetReference().ToStdString() + " (locked)" );
        else
            movable.push_back( footprint );
    }

    if( aCtx.Request.dry_run() )
    {
        for( FOOTPRINT* footprint : movable )
            response.add_placed()->set_value( footprint->m_Uuid.AsStdString() );

        response.set_report( fmt::format( "dry run: {} footprint(s) would be placed, {} skipped",
                                          movable.size(), response.skipped_size() ) );
        return response;
    }

    if( movable.empty() )
    {
        response.set_report( "no unlocked footprints to place" );
        return response;
    }

    std::unique_ptr<COMMIT> commit = createCommit();
    BOARD_COMMIT* commitPtr = dynamic_cast<BOARD_COMMIT*>( commit.get() );

    if( !commitPtr )
    {
        ApiResponseStatus e;
        e.set_status( ApiStatusCode::AS_UNKNOWN );
        e.set_error_message( "failed to create a board commit for autoplace" );
        return tl::unexpected( e );
    }

    AR_AUTOPLACER placer( brd );
    AR_RESULT result = placer.AutoplaceFootprints( movable, commitPtr,
                                                   aCtx.Request.place_offboard() );

    if( result != AR_COMPLETED )
    {
        commit->Revert();

        ApiResponseStatus e;
        e.set_status( ApiStatusCode::AS_BAD_REQUEST );

        if( result == AR_CANCELLED )
            e.set_error_message( "autoplace was cancelled; no placement was applied" );
        else
            e.set_error_message( "autoplace failed; ensure the board has a closed Edge_Cuts outline" );

        return tl::unexpected( e );
    }

    commitPtr->Push( _( "Autoplace Footprints" ) );

    for( FOOTPRINT* footprint : movable )
        response.add_placed()->set_value( footprint->m_Uuid.AsStdString() );

    response.set_report( fmt::format( "placed {} footprint(s), skipped {}",
                                      movable.size(), response.skipped_size() ) );

    return response;
}


HANDLER_RESULT<kbc::CreatePlaneResponse> API_HANDLER_PCB_AI::handleCreatePlane(
        const HANDLER_CONTEXT<kbc::CreatePlane>& aCtx )
{
    if( std::optional<ApiResponseStatus> busy = checkForBusy() )
        return tl::unexpected( *busy );

    HANDLER_RESULT<bool> documentValidation = validateDocument( aCtx.Request.board() );

    if( !documentValidation )
        return tl::unexpected( documentValidation.error() );

    BOARD* brd = board();

    NETINFO_ITEM* net = brd->FindNet( wxString::FromUTF8( aCtx.Request.net() ) );

    if( !net )
    {
        ApiResponseStatus e;
        e.set_status( ApiStatusCode::AS_BAD_REQUEST );
        e.set_error_message( fmt::format( "net '{}' not found on the board",
                                          aCtx.Request.net() ) );
        return tl::unexpected( e );
    }

    LSET layers;

    for( int layerValue : aCtx.Request.layers() )
    {
        auto layer = static_cast<kiapi::board::types::BoardLayer>( layerValue );
        PCB_LAYER_ID layerId = FromProtoEnum<PCB_LAYER_ID>( layer );

        if( !IsCopperLayer( layerId ) || !brd->IsLayerEnabled( layerId ) )
        {
            ApiResponseStatus e;
            e.set_status( ApiStatusCode::AS_BAD_REQUEST );
            e.set_error_message( "plane layers must be enabled copper layers on this board" );
            return tl::unexpected( e );
        }

        layers.set( layerId );
    }

    if( layers.count() == 0 )
    {
        ApiResponseStatus e;
        e.set_status( ApiStatusCode::AS_BAD_REQUEST );
        e.set_error_message( "at least one copper layer is required" );
        return tl::unexpected( e );
    }

    const int64_t maxInt = std::numeric_limits<int>::max();

    if( aCtx.Request.has_clearance()
        && ( aCtx.Request.clearance().value_nm() <= 0
             || aCtx.Request.clearance().value_nm() > maxInt ) )
    {
        ApiResponseStatus e;
        e.set_status( ApiStatusCode::AS_BAD_REQUEST );
        e.set_error_message( "clearance must be a positive distance that fits in 32 bits" );
        return tl::unexpected( e );
    }

    if( aCtx.Request.has_min_thickness()
        && ( aCtx.Request.min_thickness().value_nm() <= 0
             || aCtx.Request.min_thickness().value_nm() > maxInt ) )
    {
        ApiResponseStatus e;
        e.set_status( ApiStatusCode::AS_BAD_REQUEST );
        e.set_error_message( "min_thickness must be a positive distance that fits in 32 bits" );
        return tl::unexpected( e );
    }

    SHAPE_LINE_CHAIN outline;
    outline.SetClosed( true );

    if( aCtx.Request.outline_size() >= 3 )
    {
        for( const kct::Vector2& point : aCtx.Request.outline() )
            outline.Append( VECTOR2I( static_cast<int>( point.x_nm() ),
                                      static_cast<int>( point.y_nm() ) ) );

        if( std::abs( outline.Area() ) < 1.0 )
        {
            ApiResponseStatus e;
            e.set_status( ApiStatusCode::AS_BAD_REQUEST );
            e.set_error_message( "plane outline is degenerate (zero area)" );
            return tl::unexpected( e );
        }
    }
    else
    {
        // A plane drawn on the raw edge bounding box would fill right up to the
        // board edge.  Use the real board polygon (not its bbox), deflated by
        // the larger of the requested clearance and the edge clearance, so
        // non-rectangular boards keep their copper-to-edge distance.
        SHAPE_POLY_SET boardOutline;

        if( !brd->GetBoardPolygonOutlines( boardOutline, false )
            || boardOutline.OutlineCount() == 0 )
        {
            ApiResponseStatus e;
            e.set_status( ApiStatusCode::AS_BAD_REQUEST );
            e.set_error_message( "board has no valid Edge_Cuts outline; provide an explicit plane outline" );
            return tl::unexpected( e );
        }

        int inset = aCtx.Request.has_clearance()
                            ? static_cast<int>( aCtx.Request.clearance().value_nm() )
                            : 0;
        inset = std::max( inset, brd->GetDesignSettings().m_CopperEdgeClearance );
        inset = std::max( inset, pcbIUScale.mmToIU( 0.25 ) );

        boardOutline.Deflate( inset, CORNER_STRATEGY::ROUND_ALL_CORNERS, 32 );

        if( boardOutline.OutlineCount() == 0
            || boardOutline.Outline( 0 ).PointCount() < 3 )
        {
            ApiResponseStatus e;
            e.set_status( ApiStatusCode::AS_BAD_REQUEST );
            e.set_error_message( "plane outline is empty after applying edge clearance" );
            return tl::unexpected( e );
        }

        outline = boardOutline.Outline( 0 );
        outline.SetClosed( true );
    }

    std::unique_ptr<COMMIT> commit = createCommit();
    BOARD_COMMIT* commitPtr = dynamic_cast<BOARD_COMMIT*>( commit.get() );

    if( !commitPtr )
    {
        ApiResponseStatus e;
        e.set_status( ApiStatusCode::AS_UNKNOWN );
        e.set_error_message( "failed to create a board commit for plane creation" );
        return tl::unexpected( e );
    }

    ZONE* zone = new ZONE( brd );
    zone->SetLayerSet( layers );
    zone->SetNet( net );
    zone->SetIsRuleArea( false );
    zone->SetAssignedPriority( aCtx.Request.priority() );

    if( !aCtx.Request.name().empty() )
        zone->SetZoneName( wxString::FromUTF8( aCtx.Request.name() ) );

    if( aCtx.Request.has_clearance() )
        zone->SetLocalClearance( static_cast<int>( aCtx.Request.clearance().value_nm() ) );

    if( aCtx.Request.has_min_thickness() )
        zone->SetMinThickness( static_cast<int>( aCtx.Request.min_thickness().value_nm() ) );

    zone->Outline()->AddOutline( outline );
    zone->HatchBorder();

    commitPtr->Add( zone );
    commitPtr->Push( _( "Create Plane" ) );

    // The zone must be on the board before filling: the filler consults
    // BOARD::Zones() for priority and keepout decisions.
    if( aCtx.Request.fill() )
    {
        std::unique_ptr<COMMIT> fillCommit = createCommit();
        BOARD_COMMIT* fillCommitPtr = dynamic_cast<BOARD_COMMIT*>( fillCommit.get() );

        if( !fillCommitPtr )
        {
            ApiResponseStatus e;
            e.set_status( ApiStatusCode::AS_UNKNOWN );
            e.set_error_message( "failed to create a board commit for zone fill" );
            return tl::unexpected( e );
        }

        ZONE_FILLER filler( brd, fillCommitPtr );

        if( !filler.Fill( { zone } ) )
        {
            std::unique_ptr<COMMIT> cleanup = createCommit();

            if( BOARD_COMMIT* cleanupPtr = dynamic_cast<BOARD_COMMIT*>( cleanup.get() ) )
            {
                cleanupPtr->Remove( zone );
                cleanupPtr->Push( _( "Remove Unfilled Plane" ) );
            }

            ApiResponseStatus e;
            e.set_status( ApiStatusCode::AS_UNKNOWN );
            e.set_error_message( "zone fill failed; the plane was not created" );
            return tl::unexpected( e );
        }

        fillCommitPtr->Push( _( "Fill Plane" ) );
    }

    brd->BuildConnectivity();

    kbc::CreatePlaneResponse response;
    *response.mutable_plane() = makePlaneInfo( brd, zone );

    return response;
}


HANDLER_RESULT<kbc::VerifyPlaneResponse> API_HANDLER_PCB_AI::handleVerifyPlane(
        const HANDLER_CONTEXT<kbc::VerifyPlane>& aCtx )
{
    if( std::optional<ApiResponseStatus> busy = checkForBusy() )
        return tl::unexpected( *busy );

    HANDLER_RESULT<bool> documentValidation = validateDocument( aCtx.Request.board() );

    if( !documentValidation )
        return tl::unexpected( documentValidation.error() );

    std::optional<BOARD_ITEM*> item = getItemById( ::KIID( aCtx.Request.zone().value() ) );

    if( !item || ( *item )->Type() != PCB_ZONE_T )
    {
        ApiResponseStatus e;
        e.set_status( ApiStatusCode::AS_BAD_REQUEST );
        e.set_error_message( fmt::format( "zone '{}' not found on the board",
                                          aCtx.Request.zone().value() ) );
        return tl::unexpected( e );
    }

    BOARD* brd = board();
    ZONE*  zone = static_cast<ZONE*>( *item );

    if( zone->GetIsRuleArea() )
    {
        ApiResponseStatus e;
        e.set_status( ApiStatusCode::AS_BAD_REQUEST );
        e.set_error_message( "rule areas are not copper planes" );
        return tl::unexpected( e );
    }

    if( zone->NeedRefill() )
    {
        ApiResponseStatus e;
        e.set_status( ApiStatusCode::AS_BAD_REQUEST );
        e.set_error_message( "zone fill is stale; refill zones before verifying the plane" );
        return tl::unexpected( e );
    }

    kbc::VerifyPlaneResponse response;
    *response.mutable_plane() = makePlaneInfo( brd, zone );

    CONNECTIVITY_PROOF proof( brd );

    if( !proof.Build() )
    {
        ApiResponseStatus e;
        e.set_status( ApiStatusCode::AS_NOT_READY );
        e.set_error_message( "could not build board connectivity" );
        return tl::unexpected( e );
    }

    std::vector<CONNECTIVITY_ENDPOINT> endpoints = proof.Prove( {}, true );

    for( const CONNECTIVITY_ENDPOINT& endpoint : endpoints )
    {
        if( endpoint.net != zone->GetNetname() )
            continue;

        // hasCopperConnection only says the anchor touches *some* copper.  For
        // a plane check we need a connection to this specific zone.
        bool connectedToZone = false;

        for( const KIID& zoneId : endpoint.zoneIslands )
            connectedToZone |= ( zoneId == zone->m_Uuid );

        if( connectedToZone )
            continue;

        if( endpoint.itemType == wxT( "pad" ) )
            response.add_unconnected_pads()->set_value( endpoint.item.AsStdString() );
        else if( endpoint.itemType == wxT( "via" ) )
            response.add_unconnected_vias()->set_value( endpoint.item.AsStdString() );
    }

    return response;
}
