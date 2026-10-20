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

#include <connectivity/connectivity_proof.h>

#include <board.h>
#include <board_connected_item.h>
#include <connectivity/connectivity_data.h>
#include <footprint.h>
#include <geometry/shape_poly_set.h>
#include <netinfo.h>
#include <pad.h>
#include <pcb_track.h>
#include <ratsnest/ratsnest_data.h>
#include <zone.h>

#include <unordered_map>

CONNECTIVITY_PROOF::CONNECTIVITY_PROOF( BOARD* aBoard ) :
        m_board( aBoard )
{
}


bool CONNECTIVITY_PROOF::Build()
{
    if( !m_board )
        return false;

    if( !m_board->BuildConnectivity() )
        return false;

    m_connectivity = m_board->GetConnectivity();

    return m_connectivity != nullptr;
}


std::vector<CONNECTIVITY_ENDPOINT> CONNECTIVITY_PROOF::Prove(
        const std::vector<BOARD_CONNECTED_ITEM*>& aAnchors, bool aRequireFilledZones )
{
    std::vector<CONNECTIVITY_ENDPOINT> result;

    if( !m_connectivity && !Build() )
        return result;

    std::vector<BOARD_CONNECTED_ITEM*> anchors = aAnchors;

    // Group materialized zones by net so proving an anchor does not require a
    // board-wide scan of every zone.
    std::unordered_map<int, std::vector<ZONE*>> zonesByNet;

    for( ZONE* zone : m_board->Zones() )
    {
        if( zone && !zone->GetIsRuleArea() )
            zonesByNet[zone->GetNetCode()].push_back( zone );
    }

    if( anchors.empty() )
    {
        for( FOOTPRINT* footprint : m_board->Footprints() )
        {
            for( PAD* pad : footprint->Pads() )
                anchors.push_back( pad );
        }

        for( PCB_TRACK* track : m_board->Tracks() )
        {
            if( track->Type() == PCB_VIA_T )
                anchors.push_back( track );
        }
    }

    for( BOARD_CONNECTED_ITEM* anchor : anchors )
    {
        if( !anchor )
            continue;

        CONNECTIVITY_ENDPOINT endpoint;
        endpoint.item = anchor->m_Uuid;
        endpoint.net = anchor->GetNetname();

        if( anchor->Type() == PCB_PAD_T )
        {
            PAD* pad = static_cast<PAD*>( anchor );

            endpoint.itemType = wxT( "pad" );
            endpoint.padNumber = pad->GetNumber();

            if( FOOTPRINT* footprint = pad->GetParentFootprint() )
                endpoint.reference = footprint->GetReference();
        }
        else if( anchor->Type() == PCB_VIA_T )
        {
            endpoint.itemType = wxT( "via" );
        }
        else if( anchor->Type() == PCB_ARC_T )
        {
            endpoint.itemType = wxT( "arc" );
        }
        else if( anchor->Type() == PCB_TRACE_T )
        {
            endpoint.itemType = wxT( "track" );
        }
        else
        {
            endpoint.itemType = wxT( "item" );
        }

        bool hasNonZoneConnection = false;
        bool hasZoneConnection = false;

        const LSET anchorLayers = anchor->GetLayerSet();

        for( BOARD_CONNECTED_ITEM* connected : m_connectivity->GetConnectedItems( anchor ) )
        {
            if( !connected || connected->m_Uuid == anchor->m_Uuid )
                continue;

            endpoint.connectedItems.push_back( connected->m_Uuid );

            if( connected->Type() != PCB_ZONE_T )
            {
                hasNonZoneConnection = true;
                continue;
            }

            hasZoneConnection = true;

            // Point-in-fill is wrong for thermal pads: the filler knocks the
            // drill hole out of the polygon, so the pad centre is not inside
            // the fill even when thermal spokes connect it.  Trust the
            // connectivity graph (shape collisions), but require the zone fill
            // to be materialized and current.
            ZONE* zone = nullptr;

            for( ZONE* candidate : zonesByNet[anchor->GetNetCode()] )
            {
                if( candidate->m_Uuid == connected->m_Uuid )
                {
                    zone = candidate;
                    break;
                }
            }

            if( !zone || zone->NeedRefill() )
                continue;

            const LSET commonLayers = zone->GetLayerSet() & anchorLayers;
            bool       materialized = false;

            for( PCB_LAYER_ID layer : commonLayers.Seq() )
            {
                SHAPE_POLY_SET* fill = zone->GetFill( layer );

                if( fill && fill->OutlineCount() > 0 )
                {
                    materialized = true;
                    break;
                }
            }

            if( !materialized )
                continue;

            endpoint.insideFilledZone = true;

            bool alreadyRecorded = false;

            for( const KIID& zoneId : endpoint.zoneIslands )
                alreadyRecorded |= ( zoneId == zone->m_Uuid );

            if( !alreadyRecorded )
                endpoint.zoneIslands.push_back( zone->m_Uuid );
        }

        endpoint.hasCopperConnection = hasNonZoneConnection || endpoint.insideFilledZone;

        if( !aRequireFilledZones && hasZoneConnection )
            endpoint.hasCopperConnection = true;

        result.push_back( std::move( endpoint ) );
    }

    return result;
}


unsigned int CONNECTIVITY_PROOF::UnconnectedCount() const
{
    if( !m_connectivity )
        return 0;

    return m_connectivity->GetUnconnectedCount( false );
}


std::vector<wxString> CONNECTIVITY_PROOF::UnconnectedNets() const
{
    std::vector<wxString> result;

    if( !m_connectivity )
        return result;

    for( const auto& [code, net] : m_board->GetNetInfo().NetsByNetcode() )
    {
        if( code == 0 || !net )
            continue;

        RN_NET* ratsnest = m_connectivity->GetRatsnestForNet( code );

        if( ratsnest && !ratsnest->GetEdges().empty() )
            result.push_back( net->GetNetname() );
    }

    return result;
}
