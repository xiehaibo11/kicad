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

#pragma once

#include <memory>
#include <vector>

#include <kiid.h>
#include <layer_ids.h>
#include <wx/string.h>

class BOARD;
class BOARD_CONNECTED_ITEM;
class CONNECTIVITY_DATA;

/**
 * Proof that a pad, via, or track is actually connected to copper (including filled zones and
 * inner-layer planes).  Unlike a bare connectivity query, this also verifies that a zone has
 * real filled polygons on the relevant layer, which catches "poured but empty" failures.
 */
struct CONNECTIVITY_ENDPOINT
{
    KIID              item;
    wxString          itemType;
    wxString          reference;
    wxString          padNumber;
    wxString          net;
    bool              hasCopperConnection = false;
    std::vector<KIID> connectedItems;
    std::vector<KIID> zoneIslands;
    bool              insideFilledZone = false;
};

class CONNECTIVITY_PROOF
{
public:
    explicit CONNECTIVITY_PROOF( BOARD* aBoard );

    /**
     * Build (or rebuild) the connectivity database.
     */
    bool Build();

    /**
     * Prove the requested anchors.  If aAnchors is empty, all pads and vias on the board are
     * used.
     */
    std::vector<CONNECTIVITY_ENDPOINT> Prove( const std::vector<BOARD_CONNECTED_ITEM*>& aAnchors,
                                              bool aRequireFilledZones = true );

    unsigned int UnconnectedCount() const;

    /**
     * Nets whose ratsnest still has edges, i.e. nets that are not a single copper cluster.
     */
    std::vector<wxString> UnconnectedNets() const;

private:
    BOARD*                              m_board;
    std::shared_ptr<CONNECTIVITY_DATA>  m_connectivity;
};
