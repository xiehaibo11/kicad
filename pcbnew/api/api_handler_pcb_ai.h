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

#include <api/api_handler_pcb.h>

class PCB_EDIT_FRAME;

/**
 * AI automation extensions to the PCB API handler.
 *
 * Keeping these commands in a subclass isolates downstream automation from the
 * upstream API surface and makes the extensions easy to disable.
 */
class API_HANDLER_PCB_AI : public API_HANDLER_PCB
{
public:
    explicit API_HANDLER_PCB_AI( PCB_EDIT_FRAME* aFrame );
    API_HANDLER_PCB_AI( std::shared_ptr<PCB_CONTEXT> aContext, PCB_EDIT_FRAME* aFrame = nullptr );

private:
    HANDLER_RESULT<kiapi::board::commands::AutoPlaceFootprintsResponse> handleAutoPlaceFootprints(
            const HANDLER_CONTEXT<kiapi::board::commands::AutoPlaceFootprints>& aCtx );

    HANDLER_RESULT<kiapi::board::commands::CreatePlaneResponse> handleCreatePlane(
            const HANDLER_CONTEXT<kiapi::board::commands::CreatePlane>& aCtx );

    HANDLER_RESULT<kiapi::board::commands::VerifyPlaneResponse> handleVerifyPlane(
            const HANDLER_CONTEXT<kiapi::board::commands::VerifyPlane>& aCtx );
};
